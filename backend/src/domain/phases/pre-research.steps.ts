import { Inject, Injectable, Logger } from '@nestjs/common';
import { ComplianceKind, ModelTier, PhaseKey, PreResearchEvent, PreResearchState, ReviewStatus } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ConfigService } from '../../infra/config/config.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { ComplianceBlockedError } from '../../common/errors';
import { COMPLIANCE_SCORER, ComplianceScorer } from '../compliance/compliance.tokens';
import { EnrichedSubject, SubjectsService } from '../subjects/subjects.service';
import { QuestionnaireService } from '../questionnaire/questionnaire.service';
import { QuestionnaireGenerator } from '../questionnaire/questionnaire-generator';
import { QuestionnaireQuestion } from '../questionnaire/questionnaire.types';
import { feasibilitySystem, FeasibilityVerdict, buildFeasibilityUser, feasibilitySchema } from '../orchestrator/prompts/feasibility.prompt';
import { PhaseStepRegistry, StepCtx, StepOutcome } from './phase-step.tokens';
import { initSubjectBuildData } from './subject-build/draft';
import { DEFAULT_GRAPH } from './subject-build/operators';
import { SubjectBuildGraph } from './subject-build/validate';
import { SubjectStepDeps } from './subject-build/subject-build.dispatch';
import { prismaDomainStore } from './subject-build/domain-store';
import { interpretSubjectBuild } from './subject-build/subject-build.interpreter';

/** The composable subject-build phase key (its state names are author-defined). */
const SUBJECT_BUILD_KEY = 'subject_build';

/** run.data carried between pre_research steps. */
interface PreResearchRunData {
  enriched?: EnrichedSubject;
  questions?: QuestionnaireQuestion[];
}

/**
 * Step handlers for the `pre_research` workflow — the intake gate sequence that
 * used to live as one imperative block in OrchestratorService.preResearch().
 * Each DB state runs one step; DENY branches fire report:PRE_RESEARCH_DENIED via
 * the transition actions (the lifecycle handler still emails the denial).
 */
@Injectable()
export class PreResearchSteps {
  private readonly logger = new Logger(PreResearchSteps.name);

  constructor(
    registry: PhaseStepRegistry,
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(COMPLIANCE_SCORER) private readonly compliance: ComplianceScorer,
    private readonly subjects: SubjectsService,
    private readonly questionnaire: QuestionnaireService,
    private readonly questionnaireGen: QuestionnaireGenerator,
  ) {
    registry.register({ key: PhaseKey.PreResearch, state: PreResearchState.COMPLIANCE_GATE, handler: { execute: (ctx) => this.complianceGate(ctx) } });
    registry.register({ key: PhaseKey.PreResearch, state: PreResearchState.FEASIBILITY, handler: { execute: (ctx) => this.feasibility(ctx) } });
    registry.register({ key: PhaseKey.PreResearch, state: PreResearchState.SUBJECT, handler: { execute: (ctx) => this.subject(ctx) } });
    registry.register({ key: PhaseKey.PreResearch, state: PreResearchState.QUESTIONNAIRE_GEN, handler: { execute: (ctx) => this.questionnaireGenStep(ctx) } });
    registry.register({ key: PhaseKey.PreResearch, state: PreResearchState.QUESTIONNAIRE_GATE, handler: { execute: (ctx) => this.questionnaireGate(ctx) } });
  }

  /** Compliance gate on the CUSTOMER'S RAW PROMPT — a blocked request denies before any research spends a token. */
  private async complianceGate({ report, log }: StepCtx): Promise<StepOutcome> {
    await log({ message: 'Pre-researching subject + ethical/feasibility evaluation' });
    const review = await this.compliance.score({ kind: ComplianceKind.CustomerRequest, text: report.rawRequest, tier: ModelTier.Depth });
    if (review.status === ReviewStatus.Blocked) {
      await this.setDenyReason({ reportId: report.id, denyReason: `request_compliance: ${review.reason || review.categories.join(', ') || 'policy'}` });
      await log({ message: `Request blocked by the compliance gate: ${review.reason || 'policy'}`, data: { categories: review.categories, riskScore: review.score } });
      return { event: PreResearchEvent.GATE_BLOCKED };
    }
    return { event: PreResearchEvent.GATE_PASSED };
  }

  /** AI feasibility verdict. FAIL-OPEN: a model/parse failure must not block a legitimate report. */
  private async feasibility({ report, log }: StepCtx): Promise<StepOutcome> {
    if (!this.ai.isConfigured()) return { event: PreResearchEvent.FEASIBILITY_OK };
    try {
      const verdict = await this.ai.structured({
        system: feasibilitySystem(),
        user: buildFeasibilityUser({ rawRequest: report.rawRequest }),
        tier: ModelTier.Depth, // ethical/legal judgement is high-stakes
        validate: (raw) => feasibilitySchema.parse(raw),
      });
      if (verdict.decision === FeasibilityVerdict.Deny) {
        await this.setDenyReason({ reportId: report.id, denyReason: verdict.reason || 'policy' });
        await log({ message: `Pre-research denied: ${verdict.reason || 'policy'}`, data: { riskTags: verdict.riskTags } });
        return { event: PreResearchEvent.FEASIBILITY_DENY };
      }
      return { event: PreResearchEvent.FEASIBILITY_OK, dataPatch: { enriched: verdict.subject } };
    } catch (e) {
      this.logger.warn(`feasibility eval failed; proceeding without AI enrichment: ${(e as Error).message}`);
      return { event: PreResearchEvent.FEASIBILITY_OK };
    }
  }

  /** Create the Subject (idempotent — a step retry must not trip the unique reportId). */
  private async subject({ run, report, log }: StepCtx): Promise<StepOutcome> {
    const existing = await this.db.subject.findUnique({ where: { reportId: report.id }, select: { id: true } });
    if (existing) return { event: PreResearchEvent.SUBJECT_CREATED }; // idempotent redelivery

    const { enriched } = (run.data ?? {}) as PreResearchRunData;
    const graph = await this.loadSubjectBuildGraph();
    const deps: SubjectStepDeps = {
      ai: this.ai,
      findReuse: async () => null, // draft-based reuse not wired yet; reuse-lookup degrades to NO_REUSE
      persist: async ({ title, description, category }) => {
        await this.subjects.createFromReport({ reportId: report.id, rawRequest: report.rawRequest, enriched: { title, category, summary: description } });
      },
      domainStore: prismaDomainStore(this.db), // live domain memory: recall priors, learn from this build
    };

    const result = await interpretSubjectBuild({ graph, data: initSubjectBuildData({ rawRequest: report.rawRequest, enriched }), deps });
    if (result.created) {
      await log({ message: `Subject built via ${result.path.join(' → ')}`, data: { steps: result.data.stepCount } });
    } else {
      // Graceful degrade: a failed/short composition never blocks the report — fall back to the naive subject.
      this.logger.warn(`subject_build did not persist for report ${report.id} (path ${result.path.join(' → ')}) — naive fallback`);
      await this.subjects.createFromReport({ reportId: report.id, rawRequest: report.rawRequest, enriched });
    }
    return { event: PreResearchEvent.SUBJECT_CREATED };
  }

  /** The active subject_build graph (author-composed), or the seeded default (IN → enrich-basic → OUT). */
  private async loadSubjectBuildGraph(): Promise<SubjectBuildGraph> {
    const def = await this.db.workflowDefinition.findFirst({
      where: { key: SUBJECT_BUILD_KEY, status: 'active' },
      orderBy: { version: 'desc' },
      include: { states: true, transitions: true },
    });
    if (!def) return DEFAULT_GRAPH as unknown as SubjectBuildGraph;
    return {
      states: def.states.map((s) => ({ name: s.name, handler: s.handler ?? undefined, config: (s.config as SubjectBuildGraph['states'][number]['config']) ?? undefined, isInitial: s.isInitial, isTerminal: s.isTerminal })),
      transitions: def.transitions.map((t) => ({ from: t.fromState, to: t.toState, event: t.event })),
    };
  }

  /** The questionnaire agent researches the topic and generates the scope questions (static fallback inside). */
  private async questionnaireGenStep({ run, report, log }: StepCtx): Promise<StepOutcome> {
    await log({ message: 'Researching the topic to design the scope questionnaire' });
    const { enriched } = (run.data ?? {}) as PreResearchRunData;
    const questions = await this.questionnaireGen.generate({
      rawRequest: report.rawRequest,
      subject: enriched ? { title: enriched.title, summary: enriched.summary } : null,
    });
    return { event: PreResearchEvent.QUESTIONS_READY, dataPatch: { questions } };
  }

  /** Compliance-gate + create the questionnaire — a block denies the report through the DENIED terminal. */
  private async questionnaireGate({ run, report, log }: StepCtx): Promise<StepOutcome> {
    const { questions, enriched } = (run.data ?? {}) as PreResearchRunData;
    const qs = questions ?? [];
    try {
      await this.questionnaire.createForReport({ reportId: report.id, questions: qs });
    } catch (e) {
      if (e instanceof ComplianceBlockedError) {
        await this.setDenyReason({ reportId: report.id, denyReason: `questionnaire_compliance: ${String(e.details.reason ?? '')}` });
        await log({ message: 'Questionnaire blocked by compliance — denying', data: e.details });
        return { event: PreResearchEvent.QUESTIONNAIRE_BLOCKED };
      }
      throw e;
    }
    // Autopilot (HP-26): try to answer it ourselves. If the model can infer every
    // decisive dimension, we confirm the questionnaire here and the report runs
    // straight through (the send step skips the email + advances). Only when the
    // model flags a decisive question it can't infer do we leave it for the customer.
    if (this.config.autopilotQuestionnaire) {
      const subject = enriched ? { title: enriched.title, summary: enriched.summary } : null;
      const { answers, needsHuman, reason } = await this.questionnaireGen.autoAnswer({ rawRequest: report.rawRequest, subject, questions: qs });
      if (needsHuman) {
        await log({ message: 'Autopilot deferred the questionnaire to the customer (needs input)', data: { reason } });
      } else {
        const confirmed = await this.questionnaire.autofill({ reportId: report.id, answers });
        await log({ message: confirmed ? 'Autopilot answered the questionnaire — proceeding without the customer' : 'Autopilot answers were compliance-blocked — asking the customer', data: { reason } });
      }
    }
    return { event: PreResearchEvent.QUESTIONNAIRE_OK };
  }

  private async setDenyReason({ reportId, denyReason }: { reportId: string; denyReason: string }): Promise<void> {
    await this.db.report.update({ where: { id: reportId }, data: { denyReason } });
  }
}

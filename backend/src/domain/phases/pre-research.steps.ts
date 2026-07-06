import { Inject, Injectable, Logger } from '@nestjs/common';
import { ComplianceKind, ModelTier, PhaseKey, PreResearchEvent, PreResearchState, ReviewStatus } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { ComplianceBlockedError } from '../../common/errors';
import { COMPLIANCE_SCORER, ComplianceScorer } from '../compliance/compliance.tokens';
import { EnrichedSubject, SubjectsService } from '../subjects/subjects.service';
import { QuestionnaireService } from '../questionnaire/questionnaire.service';
import { QuestionnaireGenerator } from '../questionnaire/questionnaire-generator';
import { QuestionnaireQuestion } from '../questionnaire/questionnaire.types';
import { feasibilitySystem, FeasibilityVerdict, buildFeasibilityUser, feasibilitySchema } from '../orchestrator/prompts/feasibility.prompt';
import { PhaseStepRegistry, StepCtx, StepOutcome } from './phase-step.tokens';

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
  private async subject({ run, report }: StepCtx): Promise<StepOutcome> {
    const existing = await this.db.subject.findUnique({ where: { reportId: report.id }, select: { id: true } });
    if (!existing) {
      const { enriched } = (run.data ?? {}) as PreResearchRunData;
      await this.subjects.createFromReport({ reportId: report.id, rawRequest: report.rawRequest, enriched });
    }
    return { event: PreResearchEvent.SUBJECT_CREATED };
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
    const { questions } = (run.data ?? {}) as PreResearchRunData;
    try {
      await this.questionnaire.createForReport({ reportId: report.id, questions: questions ?? [] });
    } catch (e) {
      if (e instanceof ComplianceBlockedError) {
        await this.setDenyReason({ reportId: report.id, denyReason: `questionnaire_compliance: ${String(e.details.reason ?? '')}` });
        await log({ message: 'Questionnaire blocked by compliance — denying', data: e.details });
        return { event: PreResearchEvent.QUESTIONNAIRE_BLOCKED };
      }
      throw e;
    }
    return { event: PreResearchEvent.QUESTIONNAIRE_OK };
  }

  private async setDenyReason({ reportId, denyReason }: { reportId: string; denyReason: string }): Promise<void> {
    await this.db.report.update({ where: { id: reportId }, data: { denyReason } });
  }
}

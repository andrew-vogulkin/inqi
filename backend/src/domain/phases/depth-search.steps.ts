import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DepthEvent, DepthOutcome, DepthState, ModelTier, PhaseKey, QueueJob, SearchFocus, UsageKind } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { ConfigService } from '../../infra/config/config.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { WEB_SEARCH, WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import { UsageService } from '../../infra/usage/usage.service';
import { SubjectProvidersService } from '../subject-providers/subject-providers.service';
import { SubjectProviderBackground } from '../subject-providers/background.tokens';
import { reconcileDepthVerdict } from '../subject-providers/depth-reconcile';
import {
  DepthSubject, decideDepthGate, evaluateDepthVerdict, formDepthQueries, searchDepthLeads,
} from '../subject-providers/depth-lifecycle';
import {
  DepthResearchResult, DepthSearchLead, KnownFacts, buildDepthRefineUser, buildDepthResearchUser,
  depthResearchSchema, depthResearchSystem,
} from '../subject-providers/background.prompt';
import { PhaseEngine } from './phase-engine.service';
import { PhaseStepRegistry, StepCtx, StepOutcome } from './phase-step.tokens';

/** run.data carried across the depth loop (pinned at startRun; patched every step). */
export interface DepthRunData {
  name: string;
  epicId: string;
  regionHint: string | null;
  subject: DepthSubject | null;
  webRoom: number;
  matchNote: string | null;
  focus: SearchFocus | null;
  knownFacts: KnownFacts;
  maxCycles: number;
  maxToolCalls: number;
  cycle: number;              // 1-based; GATE increments on GAPS_NAMED
  queries: string[];
  leads: DepthSearchLead[];
  verdict: DepthResearchResult | null;
  /** Set when INVESTIGATE fell back deterministically — PERSIST uses it verbatim. */
  background: SubjectProviderBackground | null;
  gaps: string[];
  priorGapsKey: string;
  /** Cited-source count as of the last gate + consecutive no-new-evidence cycles (progress stall). */
  evidenceCount: number;
  noProgressStreak: number;
  outcome: DepthOutcome | null;
  notes: string[];
  // Stage-1 tunables (docs/research-phase-evolution.md) — pinned by the engine when
  // the active definition's state configs set them; absent = today's constants.
  leadsCap?: number;
  stallPatience?: number;
}

/**
 * Step handlers for the `depth_search` workflow — the per-inquiry verify→
 * strengthen loop that used to live in SubjectProvidersService.investigate().
 * The DB machine drives FORM_QUERIES → SEARCH_LEADS → INVESTIGATE → GATE
 * (→ INVESTIGATE …) → PERSIST; the PERSIST handler owns the verdict transaction
 * + settlement (actions stay thin). Also hosts the ResearchBackground worker:
 * one depth run starts per inquiry, immediately at funnel creation.
 */
@Injectable()
export class DepthSearchSteps implements OnModuleInit {
  private readonly logger = new Logger(DepthSearchSteps.name);

  constructor(
    registry: PhaseStepRegistry,
    private readonly boss: BossService,
    private readonly config: ConfigService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(WEB_SEARCH) private readonly web: WebSearchProvider,
    private readonly subjectProviders: SubjectProvidersService,
    private readonly usage: UsageService,
    private readonly engine: PhaseEngine,
  ) {
    registry.register({ key: PhaseKey.DepthSearch, state: DepthState.FORM_QUERIES, handler: { execute: (ctx) => this.formQueries(ctx) } });
    registry.register({ key: PhaseKey.DepthSearch, state: DepthState.SEARCH_LEADS, handler: { execute: (ctx) => this.searchLeads(ctx) } });
    registry.register({ key: PhaseKey.DepthSearch, state: DepthState.INVESTIGATE, handler: { execute: (ctx) => this.investigate(ctx) } });
    registry.register({ key: PhaseKey.DepthSearch, state: DepthState.GATE, handler: { execute: (ctx) => this.gate(ctx) } });
    registry.register({ key: PhaseKey.DepthSearch, state: DepthState.PERSIST, handler: { execute: (ctx) => this.persist(ctx) } });
  }

  async onModuleInit() {
    // One depth run per inquiry, started the moment the funnel creates it.
    await this.boss.work<{ reportId: string; inquiryId: string }>({
      job: QueueJob.ResearchBackground,
      handler: (job) => this.startDepthRun(job.data),
    });
  }

  /** The ResearchBackground worker body: pin context + caps into run.data and start the machine. */
  private async startDepthRun({ reportId, inquiryId }: { reportId: string; inquiryId: string }): Promise<void> {
    void this.usage.recordAction({ reportId, kind: UsageKind.BackgroundResearch });
    const context = await this.subjectProviders.depthRunContext({ reportId, inquiryId });
    const data: Omit<DepthRunData, 'name' | 'epicId' | 'regionHint' | 'subject' | 'webRoom' | 'matchNote' | 'focus' | 'knownFacts'> = {
      maxCycles: Math.max(1, this.config.research.depthCycles),
      maxToolCalls: this.config.research.depthMaxToolCalls,
      cycle: 1, queries: [], leads: [], verdict: null, background: null, gaps: [], priorGapsKey: '', evidenceCount: 0, noProgressStreak: 0, outcome: null, notes: [],
    };
    await this.engine.startRun({ key: PhaseKey.DepthSearch, reportId, inquiryId, data: { ...context, ...data } });
  }

  private data(ctx: StepCtx): DepthRunData {
    return ctx.run.data as unknown as DepthRunData;
  }

  /** B. ~5 targeted queries for the candidate. No AI → deterministic background straight to PERSIST. */
  private async formQueries(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    if (!this.ai.isConfigured()) {
      const background = await this.subjectProviders.fallbackBackground({ name: d.name, regionHint: d.regionHint, webRoom: d.webRoom });
      return { event: DepthEvent.CYCLE_CAP, dataPatch: { background, outcome: DepthOutcome.Cap, notes: [...d.notes, 'AI unconfigured — deterministic background'] } };
    }
    const queries = await formDepthQueries({ ai: this.ai, name: d.name, regionHint: d.regionHint, subject: d.subject, matchNote: d.matchNote, focus: d.focus, logger: this.logger });
    return { event: DepthEvent.QUERIES_FORMED, dataPatch: { queries } };
  }

  /** C. All queries run into one lead pool that seeds the agent's first cycle. */
  private async searchLeads(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    const leads = await searchDepthLeads({ web: this.web, name: d.name, queries: d.queries, logger: this.logger, cap: d.leadsCap });
    return { event: DepthEvent.LEADS_READY, dataPatch: { leads } };
  }

  /**
   * D. One agentic investigation cycle (web_search + open_url within the tool
   * budget). First cycle seeds from the lead pool; refine cycles target the
   * gate's named gaps. A failed cycle never fails the run: it ships the prior
   * verdict, or the deterministic fallback when there is none.
   */
  private async investigate(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    try {
      const verdict = await this.ai.toolStructured({
        system: depthResearchSystem({ focus: d.focus }),
        user: d.verdict
          ? buildDepthRefineUser({ name: d.name, regionHint: d.regionHint, subject: d.subject, prior: d.verdict, cycle: d.cycle, gaps: d.gaps })
          : buildDepthResearchUser({ name: d.name, regionHint: d.regionHint, subject: d.subject, matchNote: d.matchNote, searchLeads: d.leads, knownFacts: d.knownFacts }),
        tier: ModelTier.Depth,
        tools: this.subjectProviders.researchTools({ leads: d.leads, knownFacts: d.knownFacts }),
        maxToolCalls: d.maxToolCalls,
        validate: (raw) => depthResearchSchema.parse(raw),
        onToolCall: (c) => this.logger.log(`depth[${d.name}] c${d.cycle} tool ${c.name}(${JSON.stringify(c.args).slice(0, 120)})`),
      });
      if (d.cycle >= d.maxCycles) {
        this.logger.warn(`depth[${d.name}] cycle cap (${d.maxCycles}) reached — shipping the current verdict`);
        return { event: DepthEvent.CYCLE_CAP, dataPatch: { verdict, outcome: DepthOutcome.Cap } };
      }
      return { event: DepthEvent.VERDICT_READY, dataPatch: { verdict } };
    } catch (e) {
      const error = (e as Error).message;
      if (d.verdict) {
        this.logger.warn(`depth agent cycle ${d.cycle} failed for "${d.name}" — keeping the prior verdict: ${error}`);
        return { event: DepthEvent.CYCLE_CAP, dataPatch: { outcome: DepthOutcome.Cap, notes: [...d.notes, `cycle ${d.cycle} failed — kept prior verdict`] } };
      }
      this.logger.warn(`depth agent cycle ${d.cycle} failed for "${d.name}" — deterministic fallback: ${error}`);
      const background = await this.subjectProviders.fallbackBackground({ name: d.name, regionHint: d.regionHint, webRoom: d.webRoom });
      return { event: DepthEvent.CYCLE_CAP, dataPatch: { background, outcome: DepthOutcome.Cap, notes: [...d.notes, `cycle ${d.cycle} failed — deterministic background`] } };
    }
  }

  /** E. The evaluation gate audits the verdict; the pure decision refines or stops. */
  private async gate(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    const result = await evaluateDepthVerdict({ ai: this.ai, name: d.name, subject: d.subject, matchNote: d.matchNote, verdict: d.verdict!, focus: d.focus, logger: this.logger });
    const evidenceCount = d.verdict?.sources?.length ?? 0;
    const decision = decideDepthGate({
      sufficient: result.sufficient, gaps: result.gaps, priorGapsKey: d.priorGapsKey,
      evidenceCount, priorEvidenceCount: d.evidenceCount, noProgressStreak: d.noProgressStreak, stallPatience: d.stallPatience,
    });
    if (decision.event === DepthEvent.EVIDENCE_SUFFICIENT) {
      this.logger.log(`depth[${d.name}] gate: evidence sufficient after cycle ${d.cycle}`);
      return { event: decision.event, dataPatch: { outcome: decision.outcome } };
    }
    if (decision.event === DepthEvent.STALLED) {
      const reason = !result.gaps.length ? 'no gaps named'
        : decision.gapsKey === d.priorGapsKey ? 'same gaps twice'
        : `no new evidence for ${decision.noProgressStreak} cycles`;
      this.logger.log(`depth[${d.name}] gate: stalled after cycle ${d.cycle} (${reason}) — shipping the verdict`);
      return { event: decision.event, dataPatch: { outcome: decision.outcome } };
    }
    this.logger.log(`depth[${d.name}] gate: insufficient after cycle ${d.cycle} — ${result.gaps.join('; ')}`);
    return { event: decision.event, dataPatch: { gaps: result.gaps, priorGapsKey: decision.gapsKey, cycle: d.cycle + 1, evidenceCount, noProgressStreak: decision.noProgressStreak } };
  }

  /** Persist the verdict (tx + settle + late-snapshot refresh) and record HOW the loop ended. */
  private async persist(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    // Don't let a blocked re-verification (bot-challenge site / empty search) read as
    // "does not exist" and drop a provider breadth already found — keep it as a caution option.
    const background = reconcileDepthVerdict({ background: d.background ?? this.mapVerdict(d.verdict!), knownFacts: d.knownFacts });
    await this.subjectProviders.persistDepthVerdict({ reportId: ctx.run.reportId, inquiryId: ctx.run.inquiryId!, background, webRoom: d.webRoom });
    const event = d.outcome === DepthOutcome.Sufficient
      ? DepthEvent.PERSISTED_SUFFICIENT
      : d.outcome === DepthOutcome.Stalled ? DepthEvent.PERSISTED_STALLED : DepthEvent.PERSISTED_CAP;
    return { event };
  }

  /** The raw agent verdict → the stored background shape (same mapping the old loop used). */
  private mapVerdict(verdict: DepthResearchResult): SubjectProviderBackground {
    return {
      rating: verdict.rating ?? undefined,
      reviewsCount: verdict.reviewsCount ?? undefined,
      sentiment: verdict.sentiment,
      themes: verdict.themes,
      quotes: verdict.quotes,
      eligibility: verdict.eligibility,
      redFlags: verdict.redFlags,
      price: verdict.price ?? null,
      currency: verdict.currency ?? null,
      qualityScore: verdict.qualityScore,
      sources: verdict.sources
        .map((s) => ({ source: s.source ?? 'web', url: s.url ?? '', snippet: s.snippet ?? null }))
        .filter((s) => s.url.length > 0),
    };
  }
}

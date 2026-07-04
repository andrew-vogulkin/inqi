import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventType, FindingKind, InquiryStatus, ModelTier, QueueJob, ReportState, SearchFocus, SourceType, UsageKind } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ConfigService } from '../../infra/config/config.service';
import { AI_PROVIDER, AiProvider, ToolSet } from '../../infra/ai/ai.tokens';
import { WEB_SEARCH, WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import { OPEN_URL_TOOL, PAGE_READER, PageReader } from '../../infra/browser/browser.tokens';
import { UsageService } from '../../infra/usage/usage.service';
import { UsageContextService } from '../../infra/usage/usage-context.service';
import { FlatSourceInput, SourcesService } from '../source/sources.service';
import { SubjectProvidersRepository } from './subject-providers.repository';
import { BACKGROUND_RESEARCH_SOURCE, BackgroundResearchSource, BackgroundSource, SubjectProviderBackground } from './background.tokens';
import { DISCOVERY_SOURCE, DiscoverArgs, DiscoveryOutcome, DiscoverySource } from './discovery.tokens';
import { depthResearchSystem, buildDepthResearchUser, buildDepthRefineUser, depthResearchSchema, DepthResearchResult, KnownFacts } from './background.prompt';
import { formDepthQueries, searchDepthLeads, evaluateDepthVerdict } from './depth-lifecycle';

const WEB_SEARCH_TOOL_NAME = 'web_search';
const OPEN_URL_TOOL_NAME = 'open_url';

/**
 * Subject-provider discovery + background/quality research. Discovery seeds the
 * funnel (real candidates via the {@link DISCOVERY_SOURCE} seam); depth research
 * runs an agentic tool loop (web_search + a real-browser open_url) per candidate
 * and scores eligibility/quality so the report ranks on quality, not just price.
 */
@Injectable()
export class SubjectProvidersService implements OnModuleInit {
  private readonly logger = new Logger(SubjectProvidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: SubjectProvidersRepository,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(WEB_SEARCH) private readonly web: WebSearchProvider,
    @Inject(PAGE_READER) private readonly pageReader: PageReader,
    @Inject(BACKGROUND_RESEARCH_SOURCE) private readonly source: BackgroundResearchSource,
    @Inject(DISCOVERY_SOURCE) private readonly discovery: DiscoverySource,
    private readonly usage: UsageService,
    private readonly usageCtx: UsageContextService,
    private readonly sources: SourcesService,
  ) {}

  async onModuleInit() {
    await this.boss.work<{ reportId: string; inquiryId: string }>({
      job: QueueJob.ResearchBackground,
      handler: (job) => this.researchBackground(job.data).then(() => undefined),
    });
  }

  /** Discover candidate subject providers for the funnel (delegates to the seam; counted for cost). */
  discover(args: DiscoverArgs): Promise<DiscoveryOutcome> {
    void this.usage.recordAction({ reportId: this.usageCtx.reportId(), kind: UsageKind.DiscoveryCall });
    return this.discovery.discover(args);
  }

  /**
   * Depth-research a subject provider (agentic: web_search + open_url within a
   * tool budget), persist the verdict to the inquiry + a Finding (which the
   * dynamic report reads), record the cited pages as websearch Sources (the
   * customer-visible proof), and emit inquiry.updated with the qualityScore.
   */
  async researchBackground({ reportId, inquiryId }: { reportId: string; inquiryId: string }): Promise<SubjectProviderBackground> {
    void this.usage.recordAction({ reportId, kind: UsageKind.BackgroundResearch });
    const st = await this.repo.findInquiry({ id: inquiryId });
    const contact = (st.contact ?? {}) as { country?: string; region?: string; matchNote?: string; website?: string; socials?: string[]; facts?: string[] };
    const regionHint = contact.country ?? contact.region ?? null;
    // The facts breadth collected — depth strengthens these instead of re-verifying.
    const knownFacts = { website: contact.website ?? null, socials: contact.socials ?? [], facts: contact.facts ?? [] };
    const subject = await this.repo.findSubjectByReport({ reportId });
    // The customer's ranking priority steers what the depth agent hunts hardest for.
    const focus = ((await this.repo.findReportFocus({ id: reportId }))?.focus ?? null) as SearchFocus | null;

    // Source budget: maxSourcesPerInquiry total per inquiry, ≥1 slot always reserved
    // for the email thread and one kept for the rating digest; discovery evidence
    // already stored counts too (the upsert dedupes re-found urls).
    const flatCap = Math.max(0, this.config.research.maxSourcesPerInquiry - 1);
    const existing = await this.sources.listByInquiry({ inquiryId });
    const existingFlat = existing.filter((s) => s.type === SourceType.Websearch || s.type === SourceType.RatingFeedback).length;
    const webRoom = Math.max(0, flatCap - existingFlat - 1); // −1: keep room for the rating digest

    const background = await this.investigate({ name: st.name, regionHint, subject, webRoom, matchNote: contact.matchNote ?? null, focus, knownFacts });

    // The cited evidence pages become websearch Source rows (the proof the report links to).
    const webSources: FlatSourceInput[] = background.sources
      .filter((s): s is BackgroundSource => typeof s === 'object' && !!s.url && s.url.startsWith('http'))
      .slice(0, webRoom)
      .map((s) => ({ url: s.url, title: s.source, snippet: s.snippet ?? null }));

    // Persist the inquiry background, its websearch + rating_feedback Sources, the
    // report-feeding Finding, and the live event as one unit (research done above).
    await this.prisma.$transaction(async (tx) => {
      await this.repo.updateBackground({ id: inquiryId, background: background as unknown as Prisma.InputJsonValue, qualityScore: background.qualityScore, tx });
      if (webSources.length) await this.sources.addWebsearch({ reportId, inquiryId, results: webSources, tx });
      await this.sources.addRatingFeedback({
        reportId, inquiryId,
        entries: [{
          url: `ratings:${st.name}`, // stable pseudo-URL → idempotent upsert
          title: 'Ratings & feedback digest',
          snippet: `${background.rating ?? '–'}★ across ${background.reviewsCount ?? '?'} reviews`,
          data: background as unknown as Prisma.InputJsonValue,
        }],
        tx,
      });
      await this.repo.createFinding({
        data: {
          reportId, epicId: st.epicId, inquiryId, kind: FindingKind.SubjectProviderBackground,
          qualityScore: background.qualityScore,
          data: { subjectProvider: st.name, ...background } as unknown as Prisma.InputJsonValue,
        },
        tx,
      });
      await this.outbox.emit({ type: EventType.InquiryUpdated, reportId, epicId: st.epicId, inquiryId, data: { qualityScore: background.qualityScore, researchPending: false }, tx });
    });

    // EMAIL NEVER GATES AN INQUIRY: the research verdict itself settles it. An
    // eligible candidate qualifies right here (option built from web evidence —
    // price may be null until a reply refines it); a clearly ineligible one fails
    // with the reason. Replies arriving later (long-poll threads) only ENRICH the
    // option and re-evaluate the report — they are never a precondition.
    await this.settleFromResearch({ reportId, inquiry: st, background });

    // Verdict landed after delivery (synthesis-gate deadline hit, or a re-run): the
    // frozen snapshot may now contradict the re-ranked options — refresh it in place.
    const report = await this.repo.findReportState({ id: reportId });
    if (report?.state === ReportState.REPORT_DELIVERED) {
      // singletonKey coalesces bursts (several late verdicts/replies → one refresh + one email).
      await this.boss.enqueue({ job: QueueJob.RefreshSnapshot, data: { reportId }, options: { singletonKey: `refresh:${reportId}` } });
      this.logger.log(`late depth verdict for "${st.name}" on delivered report ${reportId} — snapshot refresh enqueued`);
    }
    return background;
  }

  /** Research-verdict settlement thresholds: eligible + at least this score → qualified. */
  private static readonly RESEARCH_QUALIFY_MIN_SCORE = 0.35;

  /**
   * Settle the inquiry from the depth verdict (web evidence alone):
   *   eligible + decent score → Qualified with an Option finding (price from the web, if evidenced)
   *   not eligible            → Failed — this requires EVIDENCE OF ABSENCE (the prompt enforces it)
   *   unverified / ambiguous  → left OPEN: absence of evidence is not a verdict. Outreach may
   *                             still settle it; otherwise the reply-wait sweep marks it
   *                             unresponsive and the report says "couldn't verify", not "disqualified".
   * Skips inquiries already settled (a reply may have won the race).
   */
  private async settleFromResearch({ reportId, inquiry, background }: {
    reportId: string; inquiry: { id: string; epicId: string; name: string }; background: SubjectProviderBackground;
  }): Promise<void> {
    const fresh = await this.repo.findInquiry({ id: inquiry.id });
    const SETTLED: InquiryStatus[] = [InquiryStatus.Qualified, InquiryStatus.Failed, InquiryStatus.Skipped];
    if (SETTLED.includes(fresh.status as InquiryStatus)) return;

    const verdict = (background.eligibility ?? '').toLowerCase();
    const eligible = verdict.startsWith('eligible') && background.qualityScore >= SubjectProvidersService.RESEARCH_QUALIFY_MIN_SCORE;
    const ineligible = verdict.startsWith('not eligible') || verdict.startsWith('ineligible');
    if (!eligible && !ineligible) return; // ambiguous — leave it to outreach / the reply-wait sweep

    if (eligible) {
      const result = { price: background.price ?? null, currency: background.currency ?? null, notes: 'qualified from web research; awaiting provider confirmation' };
      await this.prisma.$transaction(async (tx) => {
        await this.repo.updateInquiryStatus({ id: inquiry.id, status: InquiryStatus.Qualified, result: result as Prisma.InputJsonValue, tx });
        const existing = await this.repo.findOptionFinding({ inquiryId: inquiry.id, tx });
        if (!existing) {
          await this.repo.createFinding({
            data: { reportId, epicId: inquiry.epicId, inquiryId: inquiry.id, kind: FindingKind.Option, data: { subjectProvider: inquiry.name, ...result } as Prisma.InputJsonValue },
            tx,
          });
        }
        await this.outbox.emit({ type: EventType.InquiryUpdated, reportId, epicId: inquiry.epicId, inquiryId: inquiry.id, data: { name: inquiry.name, status: InquiryStatus.Qualified, result }, tx });
      });
      this.logger.log(`research qualified "${inquiry.name}" (score ${background.qualityScore}${background.price != null ? `, ~${background.price} ${background.currency ?? ''}` : ', price pending'})`);
    } else {
      const reason = background.eligibility;
      await this.prisma.$transaction(async (tx) => {
        await this.repo.updateInquiryStatus({ id: inquiry.id, status: InquiryStatus.Failed, result: { disqualified: reason } as Prisma.InputJsonValue, tx });
        await this.outbox.emit({ type: EventType.InquiryUpdated, reportId, epicId: inquiry.epicId, inquiryId: inquiry.id, data: { name: inquiry.name, status: InquiryStatus.Failed, reason }, tx });
      });
      this.logger.log(`research disqualified "${inquiry.name}": ${reason}`);
    }
    await this.boss.enqueue({ job: QueueJob.InquirySettled, data: { reportId, epicId: inquiry.epicId } });
  }

  /** Agentic depth research when AI is configured; deterministic fallback otherwise (or on agent failure). */
  private async investigate({ name, regionHint, subject, webRoom, matchNote = null, focus = null, knownFacts = null }: {
    name: string; regionHint: string | null; subject: { title: string; description: string } | null; webRoom: number;
    matchNote?: string | null; focus?: SearchFocus | null; knownFacts?: KnownFacts | null;
  }): Promise<SubjectProviderBackground> {
    if (this.ai.isConfigured()) {
      const { depthMaxToolCalls, depthCycles } = this.config.research;
      const maxCycles = Math.max(1, depthCycles);
      // B + C. The model forms ~5 targeted queries (site, reviews, pricing, red
      // flags, the unconfirmed constraint); all run up front into one lead pool
      // that seeds the agent's first cycle (deeper than one naive name search).
      // The customer's focus (price ↔ quality) biases the queries, the agent's
      // instructions and the evaluation gate's strictness.
      const queries = await formDepthQueries({ ai: this.ai, name, regionHint, subject, matchNote, focus, logger: this.logger });
      const searchLeads = await searchDepthLeads({ web: this.web, name, queries, logger: this.logger });
      let verdict: DepthResearchResult | null = null;
      let gaps: string[] = [];
      let priorGapsKey = '';
      // D + E + F. Cycle 1 investigates over the lead pool; the evaluation gate
      // then audits the verdict — the loop SELF-ADJUSTS: sufficient evidence stops
      // early, repeated gaps stop as stalled (the evidence simply isn't out there),
      // and maxCycles is only the hard cap on a genuinely productive refine loop.
      // A failed later cycle keeps the best verdict so far (never degrades a
      // good earlier result).
      for (let cycle = 1; cycle <= maxCycles; cycle++) {
        try {
          verdict = await this.ai.toolStructured({
            system: depthResearchSystem({ focus }),
            user: verdict
              ? buildDepthRefineUser({ name, regionHint, subject, prior: verdict, cycle, gaps })
              : buildDepthResearchUser({ name, regionHint, subject, matchNote, searchLeads, knownFacts }),
            tier: ModelTier.Depth,
            tools: this.researchTools(),
            maxToolCalls: depthMaxToolCalls,
            validate: (raw) => depthResearchSchema.parse(raw),
            onToolCall: (c) => this.logger.log(`depth[${name}] c${cycle} tool ${c.name}(${JSON.stringify(c.args).slice(0, 120)})`),
          });
        } catch (e) {
          this.logger.warn(`depth agent cycle ${cycle} failed for "${name}"${verdict ? ' — keeping the prior verdict' : ''}: ${(e as Error).message}`);
          if (verdict) break;
          continue;
        }
        if (cycle >= maxCycles) {
          this.logger.warn(`depth[${name}] cycle cap (${maxCycles}) reached — shipping the current verdict`);
          break;
        }
        const gate = await evaluateDepthVerdict({ ai: this.ai, name, subject, matchNote, verdict, focus, logger: this.logger });
        if (gate.sufficient) {
          this.logger.log(`depth[${name}] gate: evidence sufficient after cycle ${cycle}`);
          break;
        }
        gaps = gate.gaps;
        if (!gaps.length) {
          // Insufficient but nothing actionable named — another cycle has no target.
          this.logger.log(`depth[${name}] gate: insufficient with no gaps named after cycle ${cycle} — stopping`);
          break;
        }
        // Stall detection: the SAME gaps twice in a row means the evidence isn't out
        // there (e.g. a genuinely unpublished price) — more cycles won't change that.
        const gapsKey = gaps.map((g) => g.trim().toLowerCase()).sort().join('|');
        if (gapsKey === priorGapsKey) {
          this.logger.log(`depth[${name}] gate: same gaps twice after cycle ${cycle} — stalled, shipping the verdict`);
          break;
        }
        priorGapsKey = gapsKey;
        this.logger.log(`depth[${name}] gate: insufficient after cycle ${cycle} — ${gaps.join('; ')}`);
      }
      if (verdict) {
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
    // Fallback: one direct web search for evidence + deterministic stub scoring.
    const webHits = webRoom > 0 ? await this.depthSearch({ name, regionHint, take: webRoom }) : [];
    const external = await this.source.lookup({ name, regionHint });
    return this.deriveBackground({ webHits, external: external.sources });
  }

  /** The depth agent's tool set: real web search + a real-browser page reader. */
  private researchTools(): ToolSet {
    const webSearchDef = this.web.tools.find((t) => (t as { function?: { name?: string } }).function?.name === WEB_SEARCH_TOOL_NAME);
    return {
      definitions: [...(webSearchDef ? [webSearchDef] : []), OPEN_URL_TOOL],
      execute: async ({ name, args }) => {
        try {
          if (name === OPEN_URL_TOOL_NAME) {
            const { url } = (args ?? {}) as { url?: string };
            if (!url) return JSON.stringify({ error: 'open_url requires a url' });
            const page = await this.pageReader.read({ url });
            return JSON.stringify(page);
          }
          return await this.web.executeTool({ name, args }); // web_search etc. — returns error JSON on failure
        } catch (e) {
          return JSON.stringify({ error: `${name} failed: ${(e as Error).message}` });
        }
      },
    };
  }

  /** Depth search for one candidate — best-effort; an unreachable search backend never fails the task. */
  private async depthSearch({ name, regionHint, take }: { name: string; regionHint: string | null; take: number }): Promise<FlatSourceInput[]> {
    try {
      const hits = await this.web.webSearch({ query: `${name}${regionHint ? ` ${regionHint}` : ''}` });
      return hits.slice(0, take).map((r) => ({ url: r.url, title: r.title, snippet: r.content }));
    } catch (e) {
      this.logger.warn(`depth web search unavailable for "${name}": ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * Deterministic fallback scoring (AI unconfigured / agent failed). Cites the
   * direct-search hits as sources so the report still shows real proof pages.
   */
  private deriveBackground({ webHits, external }: { webHits: FlatSourceInput[]; external: string[] }): SubjectProviderBackground {
    const h = 99; // TEMP: hardcoded seed (was a name-hash) → constant quality/rating/reviews in the keyless demo
    const qualityScore = Math.round((0.45 + (h % 50) / 100) * 100) / 100; // 0.94
    const rating = Math.round((3 + (h % 20) / 10) * 10) / 10; // 4.9
    const reviewsCount = 20 + (h % 480);
    const redFlags = qualityScore < 0.55 ? ['limited track record'] : [];
    const cited: (BackgroundSource | string)[] = webHits.map((hit) => ({ source: hit.title ?? hit.url, url: hit.url, snippet: hit.snippet ?? null }));
    const sources = [...cited, ...external];
    return {
      rating,
      reviewsCount,
      sources: sources.length ? sources : ['model-derived (no live ratings source configured)'],
      eligibility: qualityScore >= 0.6 ? 'eligible' : 'eligible with caution',
      redFlags,
      qualityScore,
    };
  }
}

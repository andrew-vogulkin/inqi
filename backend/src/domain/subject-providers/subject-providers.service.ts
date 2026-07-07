import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventType, FindingKind, InquiryStatus, QueueJob, ReportState, SearchFocus, SourceType, isEligibleVerdict, isIneligibleVerdict, isReserveVerdict } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ConfigService } from '../../infra/config/config.service';
import { AI_PROVIDER, AiProvider, ToolSet } from '../../infra/ai/ai.tokens';
import { WEB_SEARCH, WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import { OPEN_URL_TOOL, PAGE_READER, PageReader } from '../../infra/browser/browser.tokens';
import { FlatSourceInput, SourcesService } from '../source/sources.service';
import { SubjectProvidersRepository } from './subject-providers.repository';
import { BACKGROUND_RESEARCH_SOURCE, BackgroundResearchSource, BackgroundSource, SubjectProviderBackground } from './background.tokens';
import { KnownFacts } from './background.prompt';
import { RESEARCH_QUALIFY_MIN_SCORE } from './depth-reconcile';

const WEB_SEARCH_TOOL_NAME = 'web_search';
const OPEN_URL_TOOL_NAME = 'open_url';

const safeHost = (u: string): string => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** The breadth snippet for a blocked url — exact match first, then same-host. */
function snippetForUrl(url: string, leads?: { url: string; snippet?: string | null }[]): string | undefined {
  if (!leads?.length) return undefined;
  const host = safeHost(url);
  const hit = leads.find((l) => l.url === url) ?? (host ? leads.find((l) => safeHost(l.url) === host) : undefined);
  return hit?.snippet ?? undefined;
}

/** Everything a depth_search run needs pinned into its run.data at start. */
export interface DepthRunContext {
  name: string;
  epicId: string;
  regionHint: string | null;
  subject: { title: string; description: string } | null;
  webRoom: number;
  matchNote: string | null;
  focus: SearchFocus | null;
  knownFacts: KnownFacts;
}

/**
 * Subject-provider background/quality research collaborators. The verify→
 * strengthen loop itself is the `depth_search` workflow (DB-stored states,
 * driven by the PhaseEngine — see domain/phases/depth-search.steps.ts); this
 * service owns what the steps share: the agent tool set, the run context, the
 * verdict persistence + settlement, and the deterministic no-AI fallback.
 */
@Injectable()
export class SubjectProvidersService {
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
    private readonly sources: SourcesService,
  ) {}

  /** Assemble the context a depth run pins into run.data (facts, focus, source budget). */
  async depthRunContext({ reportId, inquiryId }: { reportId: string; inquiryId: string }): Promise<DepthRunContext> {
    const st = await this.repo.findInquiry({ id: inquiryId });
    const contact = (st.contact ?? {}) as { country?: string; region?: string; matchNote?: string; website?: string; socials?: string[]; facts?: string[] };
    const subject = await this.repo.findSubjectByReport({ reportId });
    const focus = ((await this.repo.findReportFocus({ id: reportId }))?.focus ?? null) as SearchFocus | null;

    // Source budget: maxSourcesPerInquiry total per inquiry, ≥1 slot always reserved
    // for the email thread and one kept for the rating digest; discovery evidence
    // already stored counts too (the upsert dedupes re-found urls).
    const flatCap = Math.max(0, this.config.research.maxSourcesPerInquiry - 1);
    const existing = await this.sources.listByInquiry({ inquiryId });
    const existingFlat = existing.filter((s) => s.type === SourceType.Websearch || s.type === SourceType.RatingFeedback).length;
    const webRoom = Math.max(0, flatCap - existingFlat - 1); // −1: keep room for the rating digest

    return {
      name: st.name,
      epicId: st.epicId,
      regionHint: contact.country ?? contact.region ?? null,
      subject,
      webRoom,
      matchNote: contact.matchNote ?? null,
      focus,
      // The facts breadth collected — depth strengthens these instead of re-verifying.
      knownFacts: { website: contact.website ?? null, socials: contact.socials ?? [], facts: contact.facts ?? [] },
    };
  }

  /**
   * Persist a depth verdict: inquiry background + websearch/rating Sources + the
   * report-feeding Finding + the live event as one transaction, then settle the
   * inquiry from the verdict and refresh a delivered snapshot if this landed late.
   */
  async persistDepthVerdict({ reportId, inquiryId, background, webRoom }: {
    reportId: string; inquiryId: string; background: SubjectProviderBackground; webRoom: number;
  }): Promise<void> {
    const st = await this.repo.findInquiry({ id: inquiryId });

    // The cited evidence pages become websearch Source rows (the proof the report links to).
    const webSources: FlatSourceInput[] = background.sources
      .filter((s): s is BackgroundSource => typeof s === 'object' && !!s.url && s.url.startsWith('http'))
      .slice(0, Math.max(0, webRoom))
      .map((s) => ({ url: s.url, title: s.source, snippet: s.snippet ?? null }));

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
  }


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

    const verdict = background.eligibility ?? '';
    // "eligible with reservations": the core service is confirmed but formal constraints
    // mismatch — kept in the report RATED LOWER (its qualityScore reflects the mismatches),
    // never dropped on the score floor. The mismatches ride along for the dossier.
    const reserve = isReserveVerdict(verdict);
    const eligible = reserve || (isEligibleVerdict(verdict) && background.qualityScore >= RESEARCH_QUALIFY_MIN_SCORE);
    const ineligible = isIneligibleVerdict(verdict);
    if (!eligible && !ineligible) {
      // Ambiguous — leave the inquiry OPEN (outreach / the reply-wait sweep may settle
      // it), but STILL kick the reactor: this verdict just cleared researchPending, and
      // if it was the last one in flight the funnel decision is now unblocked. Without
      // this kick a report whose FINAL verdict is ambiguous wedges in OUTREACH forever.
      await this.boss.enqueue({ job: QueueJob.InquirySettled, data: { reportId, epicId: inquiry.epicId } });
      return;
    }

    if (eligible) {
      const result = {
        price: background.price ?? null, currency: background.currency ?? null,
        notes: reserve
          ? 'meets the request, but not all confirmed constraints are evidenced (see qualification)'
          : 'qualified from web research; awaiting provider confirmation',
      };
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

  /**
   * The depth agent's tool set: real web search + a real-browser page reader.
   * Optional discovery context (breadth's leads + known facts) lets a blocked
   * open_url fall back to the snippet we already have instead of reading as absence.
   */
  researchTools(ctx?: { leads?: { url: string; snippet?: string | null }[]; knownFacts?: KnownFacts | null }): ToolSet {
    const webSearchDef = this.web.tools.find((t) => (t as { function?: { name?: string } }).function?.name === WEB_SEARCH_TOOL_NAME);
    return {
      definitions: [...(webSearchDef ? [webSearchDef] : []), OPEN_URL_TOOL],
      execute: async ({ name, args }) => {
        try {
          if (name === OPEN_URL_TOOL_NAME) {
            const { url } = (args ?? {}) as { url?: string };
            if (!url) return JSON.stringify({ error: 'open_url requires a url' });
            const page = await this.pageReader.read({ url });
            if (page.blocked) {
              // The site exists but is behind a bot-challenge / login wall. Tell the agent
              // NOT to record this as absence, and hand back the discovery snippet we have.
              const evidence = snippetForUrl(url, ctx?.leads) || (ctx?.knownFacts?.facts ?? []).join(' ') || undefined;
              return JSON.stringify({
                url, blocked: true, reason: page.blockReason,
                note: 'This page could not be read directly (bot-challenge or login wall). The provider still EXISTS — do NOT record "no website" or absence. Rely on the discovery evidence below.',
                discoveryEvidence: evidence,
              });
            }
            return JSON.stringify(page);
          }
          return await this.web.executeTool({ name, args }); // web_search etc. — returns error JSON on failure
        } catch (e) {
          return JSON.stringify({ error: `${name} failed: ${(e as Error).message}` });
        }
      },
    };
  }

  /**
   * Deterministic no-AI/agent-failure background: one direct web search for
   * evidence + stub scoring, so the pipeline still produces real proof pages.
   */
  async fallbackBackground({ name, regionHint, webRoom }: { name: string; regionHint: string | null; webRoom: number }): Promise<SubjectProviderBackground> {
    const webHits = webRoom > 0 ? await this.depthSearch({ name, regionHint, take: webRoom }) : [];
    const external = await this.source.lookup({ name, regionHint });
    return this.deriveBackground({ webHits, external: external.sources });
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

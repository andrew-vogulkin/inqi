import { Inject, Injectable, Logger } from '@nestjs/common';
import { BreadthEvent, BreadthState, PhaseKey, UsageKind } from '@inqi/shared';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { WEB_SEARCH, WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import { UsageService } from '../../infra/usage/usage.service';
import { DiscoveredProvider } from '../subject-providers/discovery.tokens';
import {
  BreadthPoolHit, BreadthSubject, decideBreadthCheckpoint, fallbackCandidates, formBreadthQueries,
  mineCandidates, naiveBreadthQuery, qualifyCandidates, relaxBreadthQueries, searchBreadthPool,
} from '../subject-providers/breadth-lifecycle';
import { PhaseStepRegistry, StepCtx, StepOutcome } from './phase-step.tokens';

/** Zero-hit search cycles back off and retry (engine-suspension recovery), bounded. */
const EMPTY_SEARCH_RETRIES = 2;
const EMPTY_SEARCH_BACKOFF_MS = 75_000;
/** Backoff slice: each slice heartbeats the shadow-run lease (30s) via ctx.log. */
const EMPTY_SEARCH_HEARTBEAT_MS = 25_000;

/** run.data carried across the breadth loop (pinned at startRun; patched every step). */
export interface BreadthRunData {
  purpose: string;            // BreadthPurpose: funnel | widen
  epicId: string;
  subject: BreadthSubject;
  count: number;              // target candidate count
  maxCycles: number;          // hard cap, pinned from config at start
  cycle: number;              // 1-based; CHECKPOINT increments on CONTINUE
  exclude: string[];          // names never to propose (existing funnel, prior finds)
  queries: string[];
  pool: BreadthPoolHit[] | null; // trimmed to null once MINE consumes it (row size)
  proposed: DiscoveredProvider[];
  candidates: DiscoveredProvider[];
  seenNames: string[];
  gainedThisCycle: number;
  dryRounds: number;
  matchNote: string | null;   // set by relax rounds — their finds only partially match
  notes: string[];
  // Stage-1 tunables (docs/research-phase-evolution.md) — pinned by the engine when
  // the active definition's state configs set them; absent = today's constants.
  poolCap?: number;
  dryRoundsToStop?: number;
}

/**
 * Step handlers for the `breadth_search` workflow — the adaptive discovery loop
 * that used to live in-memory in AiDiscoverySource.discover(). The DB machine
 * drives FORM_QUERIES → SEARCH → MINE → QUALIFY → CHECKPOINT (→ RELAX → SEARCH …);
 * the CHECKPOINT handler computes the outcome event, terminals hand the gathered
 * candidates to funnel assembly.
 */
@Injectable()
export class BreadthSearchSteps {
  private readonly logger = new Logger(BreadthSearchSteps.name);

  constructor(
    registry: PhaseStepRegistry,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(WEB_SEARCH) private readonly web: WebSearchProvider,
    private readonly usage: UsageService,
  ) {
    registry.register({ key: PhaseKey.BreadthSearch, state: BreadthState.FORM_QUERIES, handler: { execute: (ctx) => this.formQueries(ctx) } });
    registry.register({ key: PhaseKey.BreadthSearch, state: BreadthState.SEARCH, handler: { execute: (ctx) => this.search(ctx) } });
    registry.register({ key: PhaseKey.BreadthSearch, state: BreadthState.MINE, handler: { execute: (ctx) => this.mine(ctx) } });
    registry.register({ key: PhaseKey.BreadthSearch, state: BreadthState.QUALIFY, handler: { execute: (ctx) => this.qualify(ctx) } });
    registry.register({ key: PhaseKey.BreadthSearch, state: BreadthState.CHECKPOINT, handler: { execute: (ctx) => this.checkpoint(ctx) } });
    registry.register({ key: PhaseKey.BreadthSearch, state: BreadthState.RELAX, handler: { execute: (ctx) => this.relax(ctx) } });
  }

  private data(ctx: StepCtx): BreadthRunData {
    return ctx.run.data as unknown as BreadthRunData;
  }

  /** B. Runs once per run. No AI → deterministic fallback candidates straight to a dry terminal. */
  private async formQueries(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    void this.usage.recordAction({ reportId: ctx.run.reportId, kind: UsageKind.DiscoveryCall });
    if (!this.ai.isConfigured()) {
      const candidates = fallbackCandidates({ count: d.count, exclude: d.exclude });
      await ctx.log({ message: `Discovery: AI unconfigured — ${candidates.length} fallback candidate(s)` });
      return { event: BreadthEvent.WENT_DRY, dataPatch: { candidates, notes: [...d.notes, 'AI unconfigured — deterministic fallback'] } };
    }
    const queries = await formBreadthQueries({ ai: this.ai, subject: d.subject, logger: this.logger });
    return { event: BreadthEvent.QUERIES_FORMED, dataPatch: { queries } };
  }

  /**
   * C. Merge + dedupe every query's hits into one pool. A COMPLETELY empty pool is
   * an infrastructure smell, not a verdict — SearXNG's upstream engines suspend for
   * a minute+ after a burst and every query in that window returns 200-with-empty,
   * which used to burn the run's relax/dry cycles in seconds. Back off and re-search
   * (bounded) so an engine suspension doesn't read as "the web has no providers".
   */
  private async search(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    const args = { web: this.web, queries: d.queries, fallbackQuery: naiveBreadthQuery({ subject: d.subject }), logger: this.logger, cap: d.poolCap };
    let pool = await searchBreadthPool(args);
    for (let retry = 1; !pool.length && retry <= EMPTY_SEARCH_RETRIES; retry += 1) {
      this.logger.warn(`discovery search returned ZERO hits across ${d.queries.length} queries (engine suspension?) — backing off ${EMPTY_SEARCH_BACKOFF_MS / 1000}s, retry ${retry}/${EMPTY_SEARCH_RETRIES}`);
      // Sliced wait: each ctx.log heartbeats the shadow-run lease (30s), so one flat
      // sleep longer than the lease would read as a stuck run to the reaper.
      for (let waited = 0; waited < EMPTY_SEARCH_BACKOFF_MS; waited += EMPTY_SEARCH_HEARTBEAT_MS) {
        await ctx.log({ message: `Web search unavailable (0 hits across every query) — waiting to retry (${Math.round((EMPTY_SEARCH_BACKOFF_MS - waited) / 1000)}s left, attempt ${retry}/${EMPTY_SEARCH_RETRIES})` });
        await new Promise((r) => setTimeout(r, Math.min(EMPTY_SEARCH_HEARTBEAT_MS, EMPTY_SEARCH_BACKOFF_MS - waited)));
      }
      pool = await searchBreadthPool(args);
    }
    return { event: BreadthEvent.POOL_READY, dataPatch: { pool } };
  }

  /** D. Relevance-gated mining. A mining failure counts as a dry round, never fails the run. */
  private async mine(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    try {
      const proposed = await mineCandidates({
        ai: this.ai, subject: d.subject, count: d.count, exclude: d.seenNames, pool: d.pool ?? [], matchNote: d.matchNote, logger: this.logger,
      });
      return { event: BreadthEvent.CANDIDATES_MINED, dataPatch: { proposed, pool: null } };
    } catch (e) {
      this.logger.warn(`AI discovery mining failed (cycle ${d.cycle}): ${(e as Error).message}`);
      return { event: BreadthEvent.CANDIDATES_MINED, dataPatch: { proposed: [], pool: null } };
    }
  }

  /** E. Cheap look-alike filter (fail-open), then dedupe into the run's find list. */
  private async qualify(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    const kept = await qualifyCandidates({ ai: this.ai, subject: d.subject, candidates: d.proposed, logger: this.logger });
    const seen = new Set(d.seenNames);
    const candidates = [...d.candidates];
    let gained = 0;
    for (const c of kept) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      candidates.push(c);
      gained++;
    }
    return { event: BreadthEvent.CANDIDATES_QUALIFIED, dataPatch: { candidates, seenNames: [...seen], gainedThisCycle: gained, proposed: [] } };
  }

  /** ✓ The adaptive checkpoint: target met / dry / cap → terminal; else CONTINUE into RELAX. */
  private async checkpoint(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    const { event, dryRounds } = decideBreadthCheckpoint({
      foundCount: d.candidates.length, targetCount: d.count, gained: d.gainedThisCycle,
      dryRounds: d.dryRounds, cycle: d.cycle, maxCycles: d.maxCycles, dryPatience: d.dryRoundsToStop,
    });
    const notes = [...d.notes];
    const patch: Record<string, unknown> = { dryRounds };
    if (event === BreadthEvent.WENT_DRY) notes.push(`search went dry after ${d.cycle} cycle(s) — stopping at ${d.candidates.length}/${d.count}`);
    if (event === BreadthEvent.CAP_REACHED) notes.push(`cycle cap (${d.maxCycles}) reached at ${d.candidates.length}/${d.count}`);
    if (event === BreadthEvent.CONTINUE) patch.cycle = d.cycle + 1;
    // NO fallback backstop here: with AI configured, a dry search must end HONESTLY
    // (assembly fails the funnel / finishes outreach) — fabricated "Subject Provider N"
    // stubs must never reach a customer report. The deterministic stubs exist only for
    // the keyless demo (the no-AI branch in FORM_QUERIES).
    if (event !== BreadthEvent.CONTINUE) await ctx.log({ message: `Discovery: ${notes[notes.length - 1] ?? `target met at ${d.candidates.length}/${d.count}`}` });
    return { event, dataPatch: { ...patch, notes } };
  }

  /** F. Relax the least-essential constraint; identical/absent relaxation exhausts the search. */
  private async relax(ctx: StepCtx): Promise<StepOutcome> {
    const d = this.data(ctx);
    const relaxed = await relaxBreadthQueries({
      ai: this.ai, subject: d.subject, priorQueries: d.queries, qualifiedCount: d.candidates.length, needed: d.count, logger: this.logger,
    });
    if (!relaxed) {
      return { event: BreadthEvent.RELAX_EXHAUSTED, dataPatch: { notes: [...d.notes, `fallback formation failed after ${d.cycle - 1} cycle(s) — stopping at ${d.candidates.length}/${d.count}`] } };
    }
    // Identical queries would only re-mine the same pool — the model has nothing new to try.
    if (relaxed.queries.join('\n') === d.queries.join('\n')) {
      return { event: BreadthEvent.RELAX_EXHAUSTED, dataPatch: { notes: [...d.notes, `fallback returned the same queries — stopping at ${d.candidates.length}/${d.count}`] } };
    }
    const note = `search converted ${d.candidates.length}/${d.count} — relaxed "${relaxed.relaxed}", re-searching`;
    await ctx.log({ message: `Discovery: ${note}` });
    return {
      event: BreadthEvent.RELAXED,
      dataPatch: {
        queries: relaxed.queries,
        matchNote: `found without "${relaxed.relaxed}" — confirm via research/outreach`,
        notes: [...d.notes, note],
      },
    };
  }
}

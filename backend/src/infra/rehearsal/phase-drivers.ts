import { Logger } from '@nestjs/common';
import { BreadthEvent, ModelTier } from '@inqi/shared';
import { AiProvider, ToolSet } from '../ai/ai.tokens';
import { WebSearchProvider } from '../websearch/websearch.tokens';
import {
  BreadthSubject, decideBreadthCheckpoint, formBreadthQueries, mineCandidates, naiveBreadthQuery,
  qualifyCandidates, relaxBreadthQueries, searchBreadthPool,
} from '../../domain/subject-providers/breadth-lifecycle';
import { formDepthQueries, searchDepthLeads } from '../../domain/subject-providers/depth-lifecycle';
import {
  DepthResearchResult, buildDepthResearchUser, depthResearchSchema, depthResearchSystem,
} from '../../domain/subject-providers/background.prompt';
import { RehearsalCase } from './rehearsal-case';
import { Check } from './scorer';

/**
 * NARROW phase drivers (docs/research-phase-evolution.md, build-order item 3):
 * run ONE phase's lifecycle over a golden case with the runner's recording
 * web-search bound in, so a breadth/depth proposal is scored on its own phase's
 * outcome — cheap, attributable, cassette-frozen. The full PipelineDriver stays
 * as the pre-publish smoke for a winner.
 */

/** The stage-1 genes a candidate rehearses under (subset of the tunable registry). */
export interface PhaseDriverTunables {
  maxCycles?: number;
  /** Queries the model forms per cycle = billable searches per cycle (config default: 6). */
  queriesPerCycle?: number;
  poolCap?: number;
  dryRoundsToStop?: number;
  leadsCap?: number;
  maxToolCalls?: number;
}

// --- breadth ---------------------------------------------------------------

export interface BreadthDriverOutcome {
  candidates: { name: string }[];
  cycles: number;
  terminal: BreadthEvent;     // TARGET_MET | WENT_DRY | CAP_REACHED | RELAX_EXHAUSTED
  notes: string[];
}

const subjectFromCase = (c: RehearsalCase): BreadthSubject => ({
  title: c.rawRequest.slice(0, 120),
  description: `${c.rawRequest}${c.geo?.label ? ` (in ${c.geo.label})` : ''}`,
});

/** The breadth loop (FORM→SEARCH→MINE→QUALIFY→CHECKPOINT→RELAX…) as one in-process pass. */
export class BreadthDriver {
  constructor(private readonly ai: AiProvider, private readonly logger = new Logger(BreadthDriver.name)) {}

  async run({ rehearsalCase, webSearch, count = 5, tunables = {} }: {
    rehearsalCase: RehearsalCase; webSearch: WebSearchProvider; count?: number; tunables?: PhaseDriverTunables;
  }): Promise<BreadthDriverOutcome> {
    const subject = subjectFromCase(rehearsalCase);
    const maxCycles = tunables.maxCycles ?? 3;
    const queryCount = tunables.queriesPerCycle ?? 6;
    let queries = await formBreadthQueries({ ai: this.ai, subject, queryCount, logger: this.logger });
    // Mirrors the live loop: a query already run is a search already paid for.
    const searched = new Set<string>();
    let matchNote: string | null = null;
    const seen = new Set<string>();
    const candidates: { name: string }[] = [];
    const notes: string[] = [];
    let dryRounds = 0;

    for (let cycle = 1; ; cycle++) {
      const fresh = [...new Set(queries)].filter((q) => !searched.has(q));
      fresh.forEach((q) => searched.add(q));
      const pool = await searchBreadthPool({ web: webSearch, queries: fresh, fallbackQuery: naiveBreadthQuery({ subject }), logger: this.logger, cap: tunables.poolCap });
      let proposed: { name: string }[] = [];
      try {
        proposed = await mineCandidates({ ai: this.ai, subject, count, exclude: [...seen], pool, matchNote, logger: this.logger });
      } catch (e) { notes.push(`mining failed on cycle ${cycle}: ${(e as Error).message}`); }
      const kept = await qualifyCandidates({ ai: this.ai, subject, candidates: proposed as never, logger: this.logger });
      let gained = 0;
      for (const c of kept) { if (!seen.has(c.name)) { seen.add(c.name); candidates.push({ name: c.name }); gained++; } }

      const decision = decideBreadthCheckpoint({ foundCount: candidates.length, targetCount: count, gained, dryRounds, cycle, maxCycles, dryPatience: tunables.dryRoundsToStop });
      dryRounds = decision.dryRounds;
      if (decision.event !== BreadthEvent.CONTINUE) return { candidates, cycles: cycle, terminal: decision.event, notes };

      const relaxed = await relaxBreadthQueries({ ai: this.ai, subject, priorQueries: [...searched], qualifiedCount: candidates.length, needed: count, queryCount, logger: this.logger });
      if (!relaxed || relaxed.queries.join('\n') === queries.join('\n')) {
        return { candidates, cycles: cycle, terminal: BreadthEvent.RELAX_EXHAUSTED, notes: [...notes, 'relaxation exhausted'] };
      }
      queries = relaxed.queries;
      matchNote = `found without "${relaxed.relaxed}"`;
    }
  }
}

/** Grade a breadth outcome against the case's breadth expectations. */
export function evaluateBreadthCase({ rehearsalCase, outcome }: { rehearsalCase: RehearsalCase; outcome: BreadthDriverOutcome }): { caseId: string; passed: boolean; checks: Check[] } {
  const e = rehearsalCase.breadth ?? {};
  const checks: Check[] = [];
  const has = (name: string) => outcome.candidates.some((c) => c.name.toLowerCase().includes(name.toLowerCase()));
  if (e.minCandidates != null) checks.push({ label: `≥ ${e.minCandidates} candidates`, ok: outcome.candidates.length >= e.minCandidates, detail: `got ${outcome.candidates.length}` });
  for (const n of e.mustSurface ?? []) checks.push({ label: `surfaces: ${n}`, ok: has(n) });
  if (!checks.length) checks.push({ label: 'no breadth expectations declared', ok: true });
  return { caseId: rehearsalCase.id, passed: checks.every((c) => c.ok), checks };
}

// --- depth -----------------------------------------------------------------

export interface DepthDriverOutcome {
  verdict: DepthResearchResult | null;
  sources: number;
  notes: string[];
}

/**
 * One depth investigate pass over a case's inquiry fixture. The tool set is
 * INJECTED so the runner can bind tools to the recording web/page providers —
 * the app-side factory wires SubjectProvidersService-equivalent tools; unit
 * tests pass a fake.
 */
export class DepthDriver {
  constructor(
    private readonly ai: AiProvider,
    private readonly toolsFor: (args: { leads: { url: string; snippet?: string | null }[]; webSearch: WebSearchProvider }) => ToolSet,
    private readonly logger = new Logger(DepthDriver.name),
  ) {}

  async run({ rehearsalCase, webSearch, tunables = {} }: {
    rehearsalCase: RehearsalCase; webSearch: WebSearchProvider; tunables?: PhaseDriverTunables;
  }): Promise<DepthDriverOutcome> {
    const fixture = rehearsalCase.depth?.fixture;
    if (!fixture) return { verdict: null, sources: 0, notes: ['case has no depth fixture'] };
    const notes: string[] = [];
    const queries = await formDepthQueries({ ai: this.ai, name: fixture.provider, regionHint: fixture.regionHint ?? null, subject: null, matchNote: null, focus: rehearsalCase.focus ?? null, logger: this.logger });
    const leads = await searchDepthLeads({ web: webSearch, name: fixture.provider, queries, logger: this.logger, cap: tunables.leadsCap });
    try {
      const verdict = await this.ai.toolStructured({
        system: depthResearchSystem({ focus: rehearsalCase.focus ?? null }),
        user: buildDepthResearchUser({ name: fixture.provider, regionHint: fixture.regionHint ?? null, subject: null, matchNote: null, searchLeads: leads, knownFacts: fixture.knownFacts ?? {} }),
        tier: ModelTier.Depth,
        tools: this.toolsFor({ leads, webSearch }),
        maxToolCalls: tunables.maxToolCalls ?? 6,
        validate: (raw) => depthResearchSchema.parse(raw),
      });
      return { verdict, sources: verdict.sources?.length ?? 0, notes };
    } catch (e) {
      return { verdict: null, sources: 0, notes: [...notes, `investigate failed: ${(e as Error).message}`] };
    }
  }
}

/** Grade a depth outcome against the case's depth expectations. */
export function evaluateDepthCase({ rehearsalCase, outcome }: { rehearsalCase: RehearsalCase; outcome: DepthDriverOutcome }): { caseId: string; passed: boolean; checks: Check[] } {
  const e = rehearsalCase.depth ?? {};
  const checks: Check[] = [];
  checks.push({ label: 'produced a verdict', ok: !!outcome.verdict });
  if (e.minSources != null) checks.push({ label: `≥ ${e.minSources} cited sources`, ok: outcome.sources >= e.minSources, detail: `got ${outcome.sources}` });
  if (e.qualityAtLeast != null) checks.push({ label: `quality ≥ ${e.qualityAtLeast}`, ok: (outcome.verdict?.qualityScore ?? 0) >= e.qualityAtLeast, detail: `got ${outcome.verdict?.qualityScore ?? 0}` });
  return { caseId: rehearsalCase.id, passed: checks.every((c) => c.ok), checks };
}

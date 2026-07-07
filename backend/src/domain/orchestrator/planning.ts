import { InquiryStatus, OutreachStrategy } from '@inqi/shared';
import { DiscoveredProvider } from '../subject-providers/discovery.tokens';

/** Escalating wave sizes (1:3:9). */
export const ESCALATING_WAVES = [1, 3, 9];
/** How many candidates to seed initially, per strategy. */
const PARALLEL_POOL = 9;
const ONE_BY_ONE_POOL = 5;

/** How many candidates discovery should propose for the initial funnel. */
export function planSize(strategy: OutreachStrategy): number {
  if (strategy === OutreachStrategy.PARALLEL) return PARALLEL_POOL;
  if (strategy === OutreachStrategy.ONE_BY_ONE) return ONE_BY_ONE_POOL;
  return ESCALATING_WAVES.reduce((a, b) => a + b, 0); // escalating: 13
}

export interface WavedProvider extends DiscoveredProvider {
  wave: number;
}

/** Assign discovered candidates to release waves per strategy. */
export function assignWaves({ candidates, strategy }: { candidates: DiscoveredProvider[]; strategy: OutreachStrategy }): WavedProvider[] {
  if (strategy === OutreachStrategy.PARALLEL) {
    return candidates.map((c) => ({ ...c, wave: 1 }));
  }
  if (strategy === OutreachStrategy.ONE_BY_ONE) {
    return candidates.map((c, i) => ({ ...c, wave: i + 1 }));
  }
  // escalating 1:3:9 — overflow falls into the last wave
  let wave = 1;
  let remaining = ESCALATING_WAVES[0];
  return candidates.map((c) => {
    if (remaining === 0 && wave < ESCALATING_WAVES.length) {
      wave += 1;
      remaining = ESCALATING_WAVES[wave - 1];
    }
    if (remaining > 0) remaining -= 1;
    return { ...c, wave };
  });
}

/**
 * The reactor's *releasable* wave set: waves that still hold `Pending` inquiries AND
 * have not been released yet. A wave already in `releasedWaves` is excluded — releasing
 * it again is a no-op (`claimWave` is idempotent), so an inquiry left `Pending` after
 * its wave was released (e.g. an ambiguous research verdict, or a send that never
 * settled it) must NOT read as releasable, or the reactor wedges forever on a Release
 * that can never progress. With the wave excluded, the reactor falls through to widen
 * or finish (delivering a partial report) instead of hanging.
 */
export function pendingUnreleasedWaves({ inquiries, releasedWaves }: {
  inquiries: { status: string; wave: number }[];
  releasedWaves: number[];
}): number[] {
  const released = new Set(releasedWaves);
  return [...new Set(inquiries.filter((i) => i.status === InquiryStatus.Pending && !released.has(i.wave)).map((i) => i.wave))];
}

/** The agentic reactor's action kinds (convention #1: no bare string comparisons). */
export const OutreachActionKind = {
  Wait: 'wait',
  Finish: 'finish',
  Release: 'release',
  Widen: 'widen',
} as const;
export type OutreachActionKind = (typeof OutreachActionKind)[keyof typeof OutreachActionKind];

/** The agentic reactor's next action after an inquiry settles. */
export type OutreachAction =
  | { kind: typeof OutreachActionKind.Wait }
  | { kind: typeof OutreachActionKind.Finish }
  | { kind: typeof OutreachActionKind.Release; wave: number }
  | { kind: typeof OutreachActionKind.Widen };

/**
 * Decide what the orchestrator does next given the live epic state. Stop at
 * target; otherwise wait for in-flight, release the next pending wave, or widen
 * discovery when the funnel is dry.
 */
export function decideNextAction({ qualified, target, inFlight, pendingWaves }: {
  qualified: number;
  target: number;
  inFlight: number;
  pendingWaves: number[];
}): OutreachAction {
  if (qualified >= target) return inFlight > 0 ? { kind: OutreachActionKind.Wait } : { kind: OutreachActionKind.Finish };
  if (inFlight > 0) return { kind: OutreachActionKind.Wait };
  if (pendingWaves.length > 0) return { kind: OutreachActionKind.Release, wave: Math.min(...pendingWaves) };
  return { kind: OutreachActionKind.Widen };
}

/** Synthesis-gate verdicts (convention #1). */
export const SynthesisGate = {
  Proceed: 'proceed',
  Defer: 'defer',
} as const;
export type SynthesisGate = (typeof SynthesisGate)[keyof typeof SynthesisGate];

/**
 * Depth-research gate before report synthesis: defer while any inquiry still has a
 * research job queued/running (so options never render with empty dossiers), but
 * never past `maxWaits` polls — a permanently failed research job must not strand
 * the report.
 */
export function decideSynthesisGate({ outstandingResearch, waits, maxWaits }: {
  outstandingResearch: number;
  waits: number;
  maxWaits: number;
}): SynthesisGate {
  return outstandingResearch > 0 && waits < maxWaits ? SynthesisGate.Defer : SynthesisGate.Proceed;
}

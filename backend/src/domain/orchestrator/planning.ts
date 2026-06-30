import { OutreachStrategy } from '@inqi/shared';
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

/** The agentic reactor's next action after a subtask settles. */
export type OutreachAction =
  | { kind: 'wait' }
  | { kind: 'finish' }
  | { kind: 'release'; wave: number }
  | { kind: 'widen' };

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
  if (qualified >= target) return inFlight > 0 ? { kind: 'wait' } : { kind: 'finish' };
  if (inFlight > 0) return { kind: 'wait' };
  if (pendingWaves.length > 0) return { kind: 'release', wave: Math.min(...pendingWaves) };
  return { kind: 'widen' };
}

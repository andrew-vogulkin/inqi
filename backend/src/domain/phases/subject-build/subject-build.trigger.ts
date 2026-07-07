/**
 * Autonomy dial for subject_build self-improvement: the chance, per delivered
 * report, that we generate a CANDIDATE subject_build composition and run it through
 * the rehearsal gate. A hit only *proposes* (drafts for operator approval); it never
 * auto-publishes. Keep this low — the rehearsal gate + operator approval already
 * throttle it, and each proposal costs a rehearsal run.
 *
 * Override with SUBJECT_BUILD_PROPOSE_PROB (e.g. 0 to disable, 1 to force every time).
 */
export const PROPOSE_PROBABILITY = clampProb(Number(process.env.SUBJECT_BUILD_PROPOSE_PROB ?? 0.05));

function clampProb(p: number): number {
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.05;
}

/**
 * Pure decision — the RNG stays at the call edge (Math.random()), this stays testable.
 * `roll` is a value in [0, 1); propose iff it falls below the probability.
 */
export function shouldPropose({ roll, probability = PROPOSE_PROBABILITY }: { roll: number; probability?: number }): boolean {
  return roll < probability;
}

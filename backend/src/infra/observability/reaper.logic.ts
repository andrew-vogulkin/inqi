import { AgentRunStatus, ReaperAction } from '@inqi/shared';

/** Minimal shape of an AgentRun the reaper reasons about (pure — no Prisma types). */
export interface ReapableRun {
  id: string;
  inquiryId: string;
  stage: string;
  status: string;
  attempts: number;
  leaseUntil: Date | null;
}

/**
 * Stuck = a `running` run whose lease has expired. The lease is extended on every
 * heartbeat, so lease-expiry already subsumes "missed N heartbeats" — one rule,
 * no clock skew between two timers. Runs without a lease are never reaped (they
 * predate leasing or aren't lease-managed).
 */
export function findStuckRuns({ runs, now }: { runs: ReapableRun[]; now: Date }): ReapableRun[] {
  return runs.filter(
    (r) => r.status === AgentRunStatus.Running && r.leaseUntil != null && r.leaseUntil.getTime() < now.getTime(),
  );
}

/**
 * What to do with a stuck run: reschedule (with backoff) while attempts remain,
 * else dead-letter it (fail) so the inquiry takes its workflow failure path.
 */
export function decideReaperAction({ attempts, maxAttempts }: { attempts: number; maxAttempts: number }): ReaperAction {
  return attempts < maxAttempts ? ReaperAction.Retry : ReaperAction.Fail;
}

/** Exponential backoff (seconds) for a retry attempt, capped. */
export function retryBackoffSeconds({ attempts, baseSeconds = 5, capSeconds = 300 }: { attempts: number; baseSeconds?: number; capSeconds?: number }): number {
  return Math.min(capSeconds, baseSeconds * 2 ** Math.max(0, attempts - 1));
}

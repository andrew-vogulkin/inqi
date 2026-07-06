import { InqiEvent } from '@inqi/shared';

/**
 * API-02 — pure realtime envelope helpers. Validation + dedupe/cursor live here so the
 * socket hook stays a thin transport and the logic is unit-testable. The layer only
 * parses + dispatches; reducers apply (idempotency is also enforced per-slice by `id`).
 */

/** Validate a raw socket payload into a typed {@link InqiEvent}, or null if malformed. */
export function parseEvent({ raw }: { raw: unknown }): InqiEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<InqiEvent>;
  if (typeof e.id !== 'string' || !e.id) return null;
  if (typeof e.type !== 'string' || !e.type) return null;
  if (typeof e.at !== 'string') return null;
  return e as InqiEvent;
}

/** Dedupe/cursor state for one subscription. */
export interface IngestState { seen: Set<string>; cursor: string }
export function createIngestState(cursor = '0'): IngestState {
  return { seen: new Set<string>(), cursor };
}

const gt = (a: string, b: string): boolean => {
  try { return BigInt(a) > BigInt(b); } catch { return a > b; }
};

/**
 * Merge a batch (live or replayed) into the ingest state: parse + validate, drop
 * duplicates by `id`, advance the cursor monotonically, and return only the **fresh**
 * events to dispatch (out-of-order safe — a stale id is dropped, not re-applied).
 */
export function ingest({ state, batch }: { state: IngestState; batch: unknown[] }): { fresh: InqiEvent[] } {
  const fresh: InqiEvent[] = [];
  for (const raw of batch ?? []) {
    const e = parseEvent({ raw });
    if (!e) continue;
    if (state.seen.has(e.id)) continue;
    state.seen.add(e.id);
    if (gt(e.id, state.cursor)) state.cursor = e.id;
    fresh.push(e);
  }
  return { fresh };
}

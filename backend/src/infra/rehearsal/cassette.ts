import { createHash } from 'node:crypto';

/**
 * Record-replay for the pipeline's external I/O (web search, page reads, …), the
 * foundation of the rehearsal harness: freeze the *environment* so a prompt/config
 * change is judged against identical evidence, while the model still runs live.
 *
 * - `off`     — pass through to the real provider (normal operation).
 * - `record`  — call the real provider AND persist (request → response) into a cassette.
 * - `replay`  — serve the recorded response; a miss is handled per {@link OnMiss}.
 */
export type RehearsalMode = 'off' | 'record' | 'replay';

/** What a `replay` does when the cassette has no entry for a request. */
export type OnMiss = 'throw' | 'live';

/** One recorded interaction. `request` is kept for debugging/inspection; lookup is by `key`. */
export interface CassetteEntry {
  kind: string;      // provider channel, e.g. "web_search", "page", "tool"
  key: string;       // stable hash of the request
  request: unknown;  // the original request (human-readable, not used for lookup)
  response: unknown; // the recorded response
}

/** Raised on a `replay` cassette miss when {@link OnMiss} is `throw`. */
export class CassetteMissError extends Error {
  constructor(public readonly kind: string, public readonly key: string, public readonly request: unknown) {
    super(`cassette miss: ${kind}:${key} — request not recorded (${JSON.stringify(request).slice(0, 120)})`);
    this.name = 'CassetteMissError';
  }
}

/** An in-memory map of recorded interactions, serialisable to/from a cassette file. */
export class Cassette {
  private readonly entries = new Map<string, CassetteEntry>();

  constructor(entries: CassetteEntry[] = []) {
    for (const e of entries) this.entries.set(`${e.kind}:${e.key}`, e);
  }

  get(kind: string, key: string): CassetteEntry | undefined {
    return this.entries.get(`${kind}:${key}`);
  }

  put({ kind, key, request, response }: CassetteEntry): void {
    this.entries.set(`${kind}:${key}`, { kind, key, request, response });
  }

  /** Recorded interactions, in insertion order — the on-disk cassette payload. */
  toJSON(): CassetteEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Stable JSON: object keys sorted recursively, so equal requests hash equal regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',');
  return `{${body}}`;
}

/** Deterministic short key for a request payload. */
export function requestKey(request: unknown): string {
  return createHash('sha256').update(stableStringify(request)).digest('hex').slice(0, 16);
}

/**
 * Route one provider call through the cassette per {@link RehearsalMode}. `off`
 * runs live untouched; `record` runs live and stores the result; `replay` returns
 * the stored result, and on a miss either throws or (onMiss `live`) runs live and
 * records the new entry so the cassette grows to cover a candidate's new queries.
 */
export async function recorded<T>({ mode, onMiss, cassette, kind, request, live }: {
  mode: RehearsalMode; onMiss: OnMiss; cassette: Cassette; kind: string; request: unknown; live: () => Promise<T>;
}): Promise<T> {
  if (mode === 'off') return live();
  const key = requestKey(request);
  if (mode === 'replay') {
    const hit = cassette.get(kind, key);
    if (hit) return hit.response as T;
    if (onMiss === 'throw') throw new CassetteMissError(kind, key, request);
  }
  const response = await live();
  cassette.put({ kind, key, request, response });
  return response;
}

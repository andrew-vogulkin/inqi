/**
 * FIFO request limiter for a model provider: at most `limit` requests run at
 * once; the rest wait in strict arrival order. Purpose-built for the LOCAL
 * provider (spark serves one GPU) — serializing requests gives every pipeline
 * job an honest queue position instead of N concurrent requests thrashing the
 * backend and starving each other.
 */
export class RequestQueue {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  /** Run `fn` when a slot frees up (FIFO). Errors release the slot like any completion. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }

  /** Requests currently waiting for a slot (observability). */
  get depth(): number {
    return this.waiters.length;
  }

  /** Requests currently executing. */
  get running(): number {
    return this.active;
  }
}

import { RequestQueue } from './request-queue';

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('RequestQueue (local provider FIFO, parallel = 1)', () => {
  it('never runs more than `limit` at once and preserves arrival order', async () => {
    const q = new RequestQueue(1);
    const started: number[] = [];
    const resolvers: Array<() => void> = [];
    const job = (n: number) => q.run(() => {
      started.push(n);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    });

    const all = Promise.all([job(1), job(2), job(3)]);
    await tick();
    expect(started).toEqual([1]);       // only one running
    expect(q.running).toBe(1);
    expect(q.depth).toBe(2);            // two honestly queued

    resolvers.shift()?.(); await tick();
    expect(started).toEqual([1, 2]);    // strict FIFO
    resolvers.shift()?.(); await tick();
    expect(started).toEqual([1, 2, 3]);
    resolvers.shift()?.();
    await all;
    expect(q.running).toBe(0);
    expect(q.depth).toBe(0);
  });

  it('a failing request releases its slot (the queue never wedges)', async () => {
    const q = new RequestQueue(1);
    const boom = q.run(async () => { throw new Error('model down'); });
    const next = q.run(async () => 'ok');
    await expect(boom).rejects.toThrow('model down');
    await expect(next).resolves.toBe('ok');
  });

  it('limit > 1 allows that much parallelism', async () => {
    const q = new RequestQueue(2);
    const resolvers: Array<() => void> = [];
    const running = () => q.running;
    const p1 = q.run(() => new Promise<void>((r) => resolvers.push(r)));
    const p2 = q.run(() => new Promise<void>((r) => resolvers.push(r)));
    const p3 = q.run(() => new Promise<void>((r) => resolvers.push(r)));
    await tick();
    expect(running()).toBe(2);
    expect(q.depth).toBe(1);
    resolvers.forEach((r) => r()); await tick();
    resolvers.forEach((r) => r());
    await Promise.all([p1, p2, p3]);
  });
});

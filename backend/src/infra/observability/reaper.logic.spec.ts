import { decideReaperAction, findStuckRuns, ReapableRun, retryBackoffSeconds } from './reaper.logic';

const run = (over: Partial<ReapableRun>): ReapableRun => ({
  id: 'r', inquiryId: 'i', stage: 'outreach_subtask', status: 'running', attempts: 1, leaseUntil: null, ...over,
});
const NOW = new Date('2026-06-29T12:00:00Z');
const past = new Date('2026-06-29T11:59:00Z');
const future = new Date('2026-06-29T12:05:00Z');

describe('findStuckRuns', () => {
  it('flags a running run whose lease has expired', () => {
    expect(findStuckRuns({ runs: [run({ leaseUntil: past })], now: NOW }).map((r) => r.id)).toEqual(['r']);
  });
  it('ignores a running run whose lease is still valid', () => {
    expect(findStuckRuns({ runs: [run({ leaseUntil: future })], now: NOW })).toHaveLength(0);
  });
  it('ignores a lease-less run (not lease-managed)', () => {
    expect(findStuckRuns({ runs: [run({ leaseUntil: null })], now: NOW })).toHaveLength(0);
  });
  it('ignores already-settled runs even with an expired lease', () => {
    for (const status of ['done', 'failed', 'cancelled', 'stopped']) {
      expect(findStuckRuns({ runs: [run({ status, leaseUntil: past })], now: NOW })).toHaveLength(0);
    }
  });
});

describe('decideReaperAction', () => {
  it('retries while attempts remain', () => expect(decideReaperAction({ attempts: 1, maxAttempts: 3 })).toBe('retry'));
  it('fails (dead-letters) at the attempt cap', () => expect(decideReaperAction({ attempts: 3, maxAttempts: 3 })).toBe('fail'));
});

describe('retryBackoffSeconds', () => {
  it('grows exponentially then caps', () => {
    expect(retryBackoffSeconds({ attempts: 1 })).toBe(5);
    expect(retryBackoffSeconds({ attempts: 2 })).toBe(10);
    expect(retryBackoffSeconds({ attempts: 3 })).toBe(20);
    expect(retryBackoffSeconds({ attempts: 99 })).toBe(300);
  });
});

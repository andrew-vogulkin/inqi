import { describe, it, expect } from 'vitest';
import { FreemiumState } from '../conventions/enums';
import { LiveReportDto, ReportOption } from '../api/types';
import { ActionType } from './actions';
import { reportReducer, initialReportState, freemiumView, ReportState } from './report.reducer';

// Redacted locked row — the FE receives ONLY id/locked/rank (no provider/price/quality).
const locked = (id: string, rank: number): ReportOption => ({ id, locked: true, rank, subjectProvider: '' });
const revealed = (name: string, rank: number, price: number, quality: number): ReportOption => ({ id: name, subjectProvider: name, locked: false, rank, price, currency: 'EUR', qualityScore: quality });

const freemiumLive = (over: Partial<LiveReportDto> = {}): LiveReportDto => ({
  reportId: 'i1', state: 'OUTREACH', delivered: false, rawRequest: 'a bike', snapshotToken: null, reusedFrom: null, summary: 'partial', freemium: true,
  options: [locked('o1', 1), locked('o2', 2), locked('o3', 3), locked('o4', 4), revealed('Taster Co', 5, 360, 0.6)],
  ...over,
});
const snap = (l: LiveReportDto, base: ReportState = initialReportState): ReportState => reportReducer(base, { type: ActionType.ReportSnapshotReceived, live: l });

describe('freemium teaser reducer', () => {
  it('locks the top-4 + reveals only #5, preserving server rank order', () => {
    const s = snap(freemiumLive());
    expect(s.freemium).toBe(true);
    expect(s.freemiumState).toBe(FreemiumState.Locked);
    const { locked: lck, revealed: rev } = freemiumView(s);
    expect(lck).toHaveLength(4);
    expect(rev).toHaveLength(1);
    expect(rev[0].subjectProvider).toBe('Taster Co');
    expect(s.order).toEqual(['o1', 'o2', 'o3', 'o4', 'Taster Co']); // by rank, not blended score
  });

  it('the FE holds NO hidden data for locked rows', () => {
    const s = snap(freemiumLive());
    for (const o of freemiumView(s).locked) {
      expect(o.subjectProvider).toBe('');
      expect(o.price).toBeUndefined();
      expect(o.qualityScore).toBeUndefined();
    }
  });

  it('locked → unlocking → unlocked reveals the full re-ranked list', () => {
    let s = snap(freemiumLive());
    s = reportReducer(s, { type: ActionType.UnlockStarted });
    expect(s.freemiumState).toBe(FreemiumState.Unlocking);
    // post-unlock snapshot: freemium false, full options
    s = snap(freemiumLive({ freemium: false, options: [revealed('Top', 1, 200, 0.95), revealed('Mid', 2, 300, 0.6), revealed('Taster Co', 3, 360, 0.5)] }), s);
    expect(s.freemiumState).toBe(FreemiumState.Unlocked);
    expect(s.order[0]).toBe('Top'); // re-ranked by blended score once unlocked
    expect(freemiumView(s).locked).toHaveLength(0);
  });

  it('idempotent reveal: a re-fetched freemium:false snapshot stays unlocked (no re-lock)', () => {
    let s = snap(freemiumLive());
    s = reportReducer(s, { type: ActionType.UnlockStarted });
    s = snap(freemiumLive({ freemium: false, options: [revealed('Top', 1, 200, 0.9)] }), s);
    s = snap(freemiumLive({ freemium: false, options: [revealed('Top', 1, 200, 0.9)] }), s); // re-fired
    expect(s.freemiumState).toBe(FreemiumState.Unlocked);
  });

  it('unlock failure reverts to Locked with a message', () => {
    let s = reportReducer(snap(freemiumLive()), { type: ActionType.UnlockStarted });
    s = reportReducer(s, { type: ActionType.UnlockFailed, message: 'Not enough credits' });
    expect(s).toMatchObject({ freemiumState: FreemiumState.Locked, error: 'Not enough credits' });
  });

  it('US-A9 edge: <5 options reveals the lowest-ranked and locks the rest (driven by snapshot)', () => {
    const s = snap(freemiumLive({ options: [locked('o1', 1), locked('o2', 2), revealed('Last', 3, 200, 0.4)] }));
    const { locked: lck, revealed: rev } = freemiumView(s);
    expect(lck).toHaveLength(2);
    expect(rev.map((o) => o.subjectProvider)).toEqual(['Last']);
  });
});

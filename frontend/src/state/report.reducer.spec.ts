import { describe, it, expect } from 'vitest';
import { EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus, ReportEventType } from '../conventions/enums';
import { LiveReportDto, ReportOption } from '../api/types';
import { ActionType } from './actions';
import { reportReducer, initialReportState, bestMatch, ReportState } from './report.reducer';

const opt = (name: string, price: number, quality: number): ReportOption => ({ subjectProvider: name, price, currency: 'EUR', qualityScore: quality });
const live = (over: Partial<LiveReportDto> = {}): LiveReportDto => ({
  reportId: 'i1', state: 'OUTREACH', delivered: false, rawRequest: 'a bike', snapshotToken: null, reusedFrom: null, summary: 'in progress', options: [], ...over,
});
const evt = (over: Partial<InqiEvent>): InqiEvent => ({ id: '1', type: EventType.AgentProgress, reportId: 'i1', at: 't', data: {}, ...over });
const snap = (l: LiveReportDto): ReportState => reportReducer(initialReportState, { type: ActionType.ReportSnapshotReceived, live: l });

describe('reportReducer — snapshot + ranking', () => {
  it('seeds from a snapshot and ranks options (quality-weighted, best first)', () => {
    // Top is high quality and not the most expensive → wins over a cheap-but-low option.
    const s = snap(live({ options: [opt('Cheap-low', 100, 0.3), opt('Top', 200, 0.95), opt('Pricey', 400, 0.7)] }));
    expect(s.status).toBe(AsyncStatus.Ready);
    expect(s.order[0]).toBe('Top');
    expect(bestMatch(s)?.subjectProvider).toBe('Top');
    expect(s.optionsById['Top'].score).toBeGreaterThan(s.optionsById['Cheap-low'].score);
  });
});

describe('reportReducer — streaming events', () => {
  it('applies a transition + report-ready (delivered + token)', () => {
    let s = snap(live());
    s = reportReducer(s, { type: ActionType.EventReceived, event: evt({ id: '5', type: EventType.ReportTransitioned, data: { to: 'REPORT_DELIVERED' } }) });
    expect(s.reportState).toBe('REPORT_DELIVERED');
    s = reportReducer(s, { type: ActionType.EventReceived, event: evt({ id: '6', type: EventType.SnapshotReady, data: { snapshotToken: 'tok' } }) });
    expect(s).toMatchObject({ delivered: true, snapshotToken: 'tok' });
    expect(s.cursor).toBe('6');
    expect(s.timeline.map((t) => t.id)).toEqual(['5', '6']);
  });

  it('is idempotent (same id twice) and out-of-order safe (timeline sorted by id)', () => {
    let s = snap(live());
    const e7 = evt({ id: '7', type: EventType.AgentProgress, data: { stage: 'outreach', message: 'sent' } });
    s = reportReducer(s, { type: ActionType.EventReceived, event: evt({ id: '10', type: EventType.AgentProgress }) });
    s = reportReducer(s, { type: ActionType.EventReceived, event: e7 });
    s = reportReducer(s, { type: ActionType.EventReceived, event: e7 }); // duplicate
    expect(s.timeline.map((t) => t.id)).toEqual(['7', '10']); // sorted, deduped
    expect(s.cursor).toBe('10'); // max, not last-applied
  });

  it('ignores events for a different report', () => {
    const s = snap(live());
    const after = reportReducer(s, { type: ActionType.EventReceived, event: evt({ id: '9', reportId: 'other', type: EventType.SnapshotReady, data: { snapshotToken: 'x' } }) });
    expect(after.delivered).toBe(false);
  });

  it('upserts an option from a finding event and re-ranks live', () => {
    // Same price → quality decides, so a quality change flips the ranking.
    let s = snap(live({ options: [opt('A', 200, 0.5)] }));
    s = reportReducer(s, { type: ActionType.EventReceived, event: evt({ id: '3', type: ReportEventType.FindingAdded as unknown as EventType, data: { option: opt('B', 200, 0.9) } }) });
    expect(s.order[0]).toBe('B'); // new top match
    expect(Object.keys(s.optionsById)).toHaveLength(2);
    // upsert (same id) updates in place + re-ranks; B's quality drops → A leads
    s = reportReducer(s, { type: ActionType.EventReceived, event: evt({ id: '4', type: ReportEventType.SnapshotUpdated as unknown as EventType, data: { option: opt('B', 200, 0.3) } }) });
    expect(Object.keys(s.optionsById)).toHaveLength(2);
    expect(s.order[0]).toBe('A');
  });
});

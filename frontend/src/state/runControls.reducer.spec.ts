import { describe, it, expect } from 'vitest';
import { EventType, ReportState, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { RunState } from '../conventions/run-controls';
import { ActionType } from './actions';
import { runControlsReducer, initialRunControlsState } from './runControls.reducer';

const seed = (reportState: string = ReportState.OUTREACH) =>
  runControlsReducer(initialRunControlsState, { type: ActionType.RunControlsLoaded, reportId: 'i1', reportState });
const evt = (over: Partial<InqiEvent>): InqiEvent => ({ id: '1', type: EventType.ReportPaused, reportId: 'i1', at: 't', data: {}, ...over });

describe('runControlsReducer', () => {
  it('seeds the run state from the board state', () => {
    expect(seed().runState).toBe(RunState.Running);
    expect(seed(ReportState.ON_HOLD).runState).toBe(RunState.Paused);
  });

  it('applies pause → resume → live', () => {
    let s = seed();
    s = runControlsReducer(s, { type: ActionType.EventReceived, event: evt({ id: '5', type: EventType.ReportPaused }) });
    expect(s.runState).toBe(RunState.Paused);
    s = runControlsReducer(s, { type: ActionType.EventReceived, event: evt({ id: '6', type: EventType.ReportResumed, data: { to: ReportState.OUTREACH } }) });
    expect(s.runState).toBe(RunState.Running);
  });

  it('cancel lands CANCELLED and the refund is reflected', () => {
    let s = seed();
    s = runControlsReducer(s, { type: ActionType.EventReceived, event: evt({ id: '7', type: EventType.ReportCancelled }) });
    expect(s.runState).toBe(RunState.Cancelled);
    expect(s.refundedCredits).toBeNull();
    s = runControlsReducer(s, { type: ActionType.EventReceived, event: evt({ id: '8', type: EventType.CreditsRefunded, data: { amount: 1 } }) });
    expect(s.refundedCredits).toBe(1);
  });

  it('is idempotent by event id and ignores other reports', () => {
    let s = seed();
    const e = evt({ id: '9', type: EventType.CreditsRefunded, data: { amount: 1 } });
    s = runControlsReducer(s, { type: ActionType.EventReceived, event: e });
    s = runControlsReducer(s, { type: ActionType.EventReceived, event: e }); // duplicate
    expect(s.refundedCredits).toBe(1);
    const before = s;
    const after = runControlsReducer(s, { type: ActionType.EventReceived, event: evt({ id: '10', reportId: 'other', type: EventType.ReportCancelled }) });
    expect(after).toBe(before);
  });

  it('loads the settlement preview', () => {
    let s = seed();
    s = runControlsReducer(s, { type: ActionType.RunPreviewLoading });
    expect(s.previewStatus).toBe(AsyncStatus.Loading);
    s = runControlsReducer(s, { type: ActionType.RunPreviewLoaded, preview: { costSoFarUsd: 0.42, currency: 'USD', creditOnCancel: 1 } });
    expect(s.previewStatus).toBe(AsyncStatus.Ready);
    expect(s.preview?.costSoFarUsd).toBe(0.42);
  });

  it('switching report resets the per-report reflections', () => {
    let s = seed();
    s = runControlsReducer(s, { type: ActionType.EventReceived, event: evt({ id: '11', type: EventType.CreditsRefunded, data: { amount: 1 } }) });
    expect(s.refundedCredits).toBe(1);
    s = runControlsReducer(s, { type: ActionType.RunControlsLoaded, reportId: 'i2', reportState: ReportState.OUTREACH });
    expect(s.reportId).toBe('i2');
    expect(s.refundedCredits).toBeNull();
    expect(s.seen).toEqual({});
  });
});

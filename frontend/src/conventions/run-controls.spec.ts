import { describe, it, expect } from 'vitest';
import { ReportState, InquiryStatus } from '@inqi/shared';
import {
  RunState, RunAction, runStateFromReport, runActionEnabled, isTerminalRunState, countInFlightJobs,
} from './run-controls';

describe('runStateFromReport — projection', () => {
  it('maps granular report states onto the coarse run state', () => {
    expect(runStateFromReport({ state: ReportState.ON_HOLD })).toBe(RunState.Paused);
    expect(runStateFromReport({ state: ReportState.CANCELLED })).toBe(RunState.Cancelled);
    expect(runStateFromReport({ state: ReportState.REPORT_DELIVERED })).toBe(RunState.Delivered);
    expect(runStateFromReport({ state: ReportState.FAILED })).toBe(RunState.Failed);
    expect(runStateFromReport({ state: ReportState.OUTREACH })).toBe(RunState.Running);
    expect(runStateFromReport({ state: ReportState.PRE_RESEARCH })).toBe(RunState.Running);
  });
});

describe('runActionEnabled — the button state machine', () => {
  it('Pause is enabled only while Running', () => {
    expect(runActionEnabled({ runState: RunState.Running, action: RunAction.Pause })).toBe(true);
    expect(runActionEnabled({ runState: RunState.Paused, action: RunAction.Pause })).toBe(false);
    expect(runActionEnabled({ runState: RunState.Cancelled, action: RunAction.Pause })).toBe(false);
  });
  it('Resume is enabled only while Paused', () => {
    expect(runActionEnabled({ runState: RunState.Paused, action: RunAction.Resume })).toBe(true);
    expect(runActionEnabled({ runState: RunState.Running, action: RunAction.Resume })).toBe(false);
  });
  it('Cancel is enabled until a terminal state', () => {
    expect(runActionEnabled({ runState: RunState.Running, action: RunAction.Cancel })).toBe(true);
    expect(runActionEnabled({ runState: RunState.Paused, action: RunAction.Cancel })).toBe(true);
    expect(runActionEnabled({ runState: RunState.Cancelled, action: RunAction.Cancel })).toBe(false);
    expect(runActionEnabled({ runState: RunState.Delivered, action: RunAction.Cancel })).toBe(false);
    expect(runActionEnabled({ runState: RunState.Failed, action: RunAction.Cancel })).toBe(false);
  });
});

describe('isTerminalRunState / countInFlightJobs', () => {
  it('flags terminal run states', () => {
    expect(isTerminalRunState(RunState.Cancelled)).toBe(true);
    expect(isTerminalRunState(RunState.Running)).toBe(false);
    expect(isTerminalRunState(RunState.Paused)).toBe(false);
  });
  it('counts only actively researching/contacted inquiries as in-flight', () => {
    const statuses = [InquiryStatus.Researching, InquiryStatus.Contacted, InquiryStatus.Qualified, InquiryStatus.Pending, InquiryStatus.Failed];
    expect(countInFlightJobs({ statuses })).toBe(2);
    expect(countInFlightJobs({ statuses: [] })).toBe(0);
  });
});

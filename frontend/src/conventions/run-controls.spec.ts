import { describe, it, expect } from 'vitest';
import { InquiryState, SubtaskStatus } from '@inqi/shared';
import {
  RunState, RunAction, runStateFromInquiry, runActionEnabled, isTerminalRunState, countInFlightJobs,
} from './run-controls';

describe('runStateFromInquiry — projection', () => {
  it('maps granular inquiry states onto the coarse run state', () => {
    expect(runStateFromInquiry({ state: InquiryState.ON_HOLD })).toBe(RunState.Paused);
    expect(runStateFromInquiry({ state: InquiryState.CANCELLED })).toBe(RunState.Cancelled);
    expect(runStateFromInquiry({ state: InquiryState.REPORT_DELIVERED })).toBe(RunState.Delivered);
    expect(runStateFromInquiry({ state: InquiryState.FAILED })).toBe(RunState.Failed);
    expect(runStateFromInquiry({ state: InquiryState.OUTREACH })).toBe(RunState.Running);
    expect(runStateFromInquiry({ state: InquiryState.PRE_RESEARCH })).toBe(RunState.Running);
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
  it('counts only actively researching/contacted subtasks as in-flight', () => {
    const statuses = [SubtaskStatus.Researching, SubtaskStatus.Contacted, SubtaskStatus.Qualified, SubtaskStatus.Pending, SubtaskStatus.Failed];
    expect(countInFlightJobs({ statuses })).toBe(2);
    expect(countInFlightJobs({ statuses: [] })).toBe(0);
  });
});

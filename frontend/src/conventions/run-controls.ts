import { ReportState, InquiryStatus } from '@inqi/shared';
import { StatusTone } from './enums';

/**
 * FE-12 — operator run-control state machine. The backend's granular
 * {@link ReportState} is projected onto a coarse {@link RunState} the operator
 * reasons about (running / paused / a terminal). All enablement + apply logic
 * lives here (convention #2); the component is a pure view over it.
 */
export const RunState = {
  Running: 'running',
  Paused: 'paused',
  Cancelled: 'cancelled',
  Delivered: 'delivered',
  Failed: 'failed',
  Denied: 'denied',
  Dropped: 'dropped',
} as const;
export type RunState = (typeof RunState)[keyof typeof RunState];

/** The three operator actions (POST /reports/:id/{pause,resume,cancel}). */
export const RunAction = {
  Pause: 'pause',
  Resume: 'resume',
  Cancel: 'cancel',
} as const;
export type RunAction = (typeof RunAction)[keyof typeof RunAction];

/** The settlement preview shown in the confirm dialog (cost-so-far + refund). */
export interface SettlementPreview {
  costSoFarUsd: number;
  currency: string;
  creditOnCancel: number;
}

export const RUN_ACTION_LABEL: Record<RunAction, string> = {
  [RunAction.Pause]: 'Pause',
  [RunAction.Resume]: 'Resume',
  [RunAction.Cancel]: 'Cancel & refund',
};

/**
 * Backend default report reservation (`REPORT_COST_CREDITS`, default 1 — HP-19).
 * The settlement preview shows this as the credit refunded on cancel; the *exact*
 * amount is then confirmed live via the `credits.refunded` event.
 */
export const DEFAULT_REPORT_COST_CREDITS = 1;

const TERMINAL: RunState[] = [
  RunState.Cancelled, RunState.Delivered, RunState.Failed, RunState.Denied, RunState.Dropped,
];

export function isTerminalRunState(runState: RunState): boolean {
  return TERMINAL.includes(runState);
}

/** Coarse projection of a granular report state onto the run-state machine. */
export function runStateFromReport({ state }: { state: string }): RunState {
  switch (state) {
    case ReportState.ON_HOLD: return RunState.Paused;
    case ReportState.CANCELLED: return RunState.Cancelled;
    case ReportState.REPORT_DELIVERED: return RunState.Delivered;
    case ReportState.FAILED: return RunState.Failed;
    case ReportState.DENIED: return RunState.Denied;
    case ReportState.DROPPED: return RunState.Dropped;
    default: return RunState.Running; // any active intake/processing state
  }
}

/**
 * Button-enablement state machine: Pause⟷Running, Resume⟷Paused, Cancel until a
 * terminal state. (The spec's "Cancel until Cancelled" — implemented as "not yet
 * terminal", so a delivered/failed run also can't be cancelled.)
 */
export function runActionEnabled({ runState, action }: { runState: RunState; action: RunAction }): boolean {
  switch (action) {
    case RunAction.Pause: return runState === RunState.Running;
    case RunAction.Resume: return runState === RunState.Paused;
    case RunAction.Cancel: return !isTerminalRunState(runState);
    default: return false;
  }
}

/**
 * In-flight outreach jobs the cancel would abandon = inquiries actively researching
 * or contacted (board-derived; the `/cost` summary does not expose this).
 */
export function countInFlightJobs({ statuses }: { statuses: string[] }): number {
  return statuses.filter((s) => s === InquiryStatus.Researching || s === InquiryStatus.Contacted).length;
}

export function runStateTone(runState: RunState): StatusTone {
  switch (runState) {
    case RunState.Delivered: return StatusTone.Brand;
    case RunState.Cancelled: return StatusTone.Warn;
    case RunState.Paused: return StatusTone.Warn;
    case RunState.Failed:
    case RunState.Denied:
    case RunState.Dropped: return StatusTone.Danger;
    default: return StatusTone.Info; // running
  }
}

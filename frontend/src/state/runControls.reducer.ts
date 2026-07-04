import { EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { RunState, SettlementPreview, runStateFromReport } from '../conventions/run-controls';
import { Action, ActionType } from './actions';

export interface RunControlsState {
  reportId: string | null;
  runState: RunState;
  refundedCredits: number | null; // set live by credits.refunded (cancel → refund)
  preview: SettlementPreview | null;
  previewStatus: AsyncStatus;
  seen: Record<string, true>;
}

export const initialRunControlsState: RunControlsState = {
  reportId: null,
  runState: RunState.Running,
  refundedCredits: null,
  preview: null,
  previewStatus: AsyncStatus.Idle,
  seen: {},
};

/**
 * FE-12 — operator run controls. Seeds from the board's current state, then the
 * enablement state machine reflects pause/resume/cancel **live** from admin-room
 * events; a cancel's `credits.refunded` is reflected as `refundedCredits`. Apply
 * logic is here (convention #2); idempotent by event id, scoped to the report.
 */
export function runControlsReducer(state: RunControlsState, action: Action): RunControlsState {
  switch (action.type) {
    case ActionType.RunControlsLoaded: {
      const runState = runStateFromReport({ state: action.reportState });
      // New report → reset the per-report reflections; same report → just sync state.
      if (action.reportId !== state.reportId) {
        return { ...initialRunControlsState, reportId: action.reportId, runState };
      }
      return { ...state, runState };
    }

    case ActionType.RunPreviewLoading:
      return { ...state, previewStatus: AsyncStatus.Loading };

    case ActionType.RunPreviewLoaded:
      return { ...state, previewStatus: AsyncStatus.Ready, preview: action.preview };

    case ActionType.EventReceived: {
      const e: InqiEvent = action.event;
      if (!state.reportId || e.reportId !== state.reportId) return state;
      if (state.seen[e.id]) return state;
      const seen = { ...state.seen, [e.id]: true as const };
      const d = (e.data ?? {}) as { to?: string; amount?: number };

      switch (e.type) {
        case EventType.ReportPaused:
          return { ...state, seen, runState: RunState.Paused };
        case EventType.ReportResumed:
          return { ...state, seen, runState: runStateFromReport({ state: String(d.to ?? '') }) };
        case EventType.ReportCancelled:
          return { ...state, seen, runState: RunState.Cancelled };
        case EventType.ReportTransitioned:
          return d.to ? { ...state, seen, runState: runStateFromReport({ state: String(d.to) }) } : { ...state, seen };
        case EventType.CreditsRefunded:
          return { ...state, seen, refundedCredits: (state.refundedCredits ?? 0) + Number(d.amount ?? 0) };
        default:
          return { ...state, seen };
      }
    }

    default:
      return state;
  }
}

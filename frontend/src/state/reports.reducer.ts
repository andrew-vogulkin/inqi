import { EventType } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { ReportDto } from '../api/types';
import { Action, ActionType } from './actions';

export interface ReportsState {
  status: AsyncStatus;
  byId: Record<string, ReportDto>;
  order: string[]; // display order (most recent first, as loaded)
}
export const initialReportsState: ReportsState = { status: AsyncStatus.Idle, byId: {}, order: [] };

function index(reports: ReportDto[]): Pick<ReportsState, 'byId' | 'order'> {
  const byId: Record<string, ReportDto> = {};
  const order: string[] = [];
  for (const i of reports) { byId[i.id] = i; order.push(i.id); }
  return { byId, order };
}

/** Customer's reports slice. A transition event updates the matching report's state. */
export function reportsReducer(state: ReportsState, action: Action): ReportsState {
  switch (action.type) {
    case ActionType.ReportsLoaded:
      return { status: AsyncStatus.Ready, ...index(action.reports) };
    case ActionType.ReportUpserted: {
      const i = action.report;
      const exists = !!state.byId[i.id];
      return {
        ...state,
        byId: { ...state.byId, [i.id]: i },
        order: exists ? state.order : [i.id, ...state.order],
      };
    }
    case ActionType.EventReceived: {
      const e = action.event;
      // HP-23: a transition carries the new state AND the derived stage/qualifiedCount.
      // A stage-only transition (to === from) updates the pipeline without a state change.
      if (e.type === EventType.ReportTransitioned && state.byId[e.reportId]) {
        const d = (e.data ?? {}) as { to?: string; stage?: string; qualifiedCount?: number };
        const cur = state.byId[e.reportId];
        const next = {
          ...cur,
          ...(d.to ? { state: d.to } : {}),
          ...(d.stage ? { stage: d.stage } : {}),
          ...(typeof d.qualifiedCount === 'number' ? { qualifiedCount: d.qualifiedCount } : {}),
        };
        return { ...state, byId: { ...state.byId, [e.reportId]: next } };
      }
      return state;
    }
    default:
      return state;
  }
}

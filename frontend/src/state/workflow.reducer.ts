import { EventType, WorkflowStatus, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { WorkflowPanel, applyPublished } from '../conventions/workflow';
import { WorkflowVersionDto, WorkflowInspectDto, VersionDiffResultDto } from '../api/types';
import { Action, ActionType } from './actions';

export interface WorkflowState {
  status: AsyncStatus;
  versions: WorkflowVersionDto[];
  selectedId: string | null;
  panel: WorkflowPanel;
  inspect: WorkflowInspectDto | null;
  diff: VersionDiffResultDto | null;
  seen: Record<string, true>;
}

export const initialWorkflowState: WorkflowState = {
  status: AsyncStatus.Idle,
  versions: [],
  selectedId: null,
  panel: WorkflowPanel.Diagram,
  inspect: null,
  diff: null,
  seen: {},
};

/** Default selection: the active version, else the first listed. */
function pickSelected(versions: WorkflowVersionDto[], prev: string | null): string | null {
  if (prev && versions.some((v) => v.id === prev)) return prev;
  return versions.find((v) => v.status === WorkflowStatus.Active)?.id ?? versions[0]?.id ?? null;
}

/**
 * FE-15 — workflow versions. Tree/diff derivation are pure selectors (conventions);
 * this slice holds the loaded versions, the selection + panel, and applies a
 * `workflow.published` active/archived swap live (idempotent by event id).
 */
export function workflowReducer(state: WorkflowState, action: Action): WorkflowState {
  switch (action.type) {
    case ActionType.WorkflowsLoaded:
      return { ...state, status: AsyncStatus.Ready, versions: action.versions, selectedId: pickSelected(action.versions, state.selectedId) };

    case ActionType.WorkflowVersionSelected:
      return { ...state, selectedId: action.id, panel: WorkflowPanel.Diagram, inspect: null, diff: null };

    case ActionType.WorkflowPanelToggled:
      return { ...state, panel: action.panel };

    case ActionType.WorkflowInspectLoaded:
      return action.inspect.id === state.selectedId ? { ...state, inspect: action.inspect } : state;

    case ActionType.WorkflowDiffLoaded:
      return { ...state, diff: action.diff };

    case ActionType.EventReceived: {
      const e: InqiEvent = action.event;
      if (e.type !== EventType.WorkflowPublished) return state;
      if (state.seen[e.id]) return state;
      const seen = { ...state.seen, [e.id]: true as const };
      const publishedId = String((e.data as { id?: string } | undefined)?.id ?? '');
      if (!publishedId) return { ...state, seen };
      return { ...state, seen, versions: applyPublished({ versions: state.versions, publishedId }) };
    }

    default:
      return state;
  }
}

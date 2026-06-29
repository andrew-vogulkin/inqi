import { EventType, SubtaskStatus, InquiryState, InqiEvent } from '@inqi/shared';
import { AsyncStatus, ReportEventType } from '../conventions/enums';
import { InquiryBoardDto } from '../api/types';
import { Action, ActionType } from './actions';

const EVENT_CAP = 200;

export interface SubtaskVM { id: string; epicId: string; provider: string; wave: number; status: string; qualityScore?: number | null; personaId?: string | null }
export interface EpicVM { id: string; strategy: string; status: string; target: number; releasedWaves: number[]; subtaskIds: string[] }
export interface FindingVM { id: string; subtaskId?: string; kind: string }
export interface BoardEventItem { id: string; type: string; at: string; epicId?: string; subtaskId?: string; data: Record<string, unknown> }

export interface AdminBoardState {
  status: AsyncStatus;
  inquiryId: string | null;
  title: string;
  inquiryState: string;
  epicsById: Record<string, EpicVM>;
  epicOrder: string[];
  subtasksById: Record<string, SubtaskVM>;
  findingsById: Record<string, FindingVM>;
  lineage: { userRequest: string; initialResearch: string; confirmedScope: string };
  events: BoardEventItem[]; // agent activity stream
  cursor: string;
  seen: Record<string, true>;
}

export const initialAdminBoardState: AdminBoardState = {
  status: AsyncStatus.Idle,
  inquiryId: null,
  title: '',
  inquiryState: '',
  epicsById: {},
  epicOrder: [],
  subtasksById: {},
  findingsById: {},
  lineage: { userRequest: '', initialResearch: '', confirmedScope: '' },
  events: [],
  cursor: '0',
  seen: {},
};

// ---- pure selectors (unit-tested) -----------------------------------------

/** Subtasks of an epic, in insertion order. */
export function epicSubtasks(state: AdminBoardState, epicId: string): SubtaskVM[] {
  const epic = state.epicsById[epicId];
  return epic ? epic.subtaskIds.map((id) => state.subtasksById[id]).filter(Boolean) : [];
}

/** "Need attention" = the epic has a failed subtask (the real status for suspended/error). */
export function epicNeedsAttention(state: AdminBoardState, epicId: string): boolean {
  return epicSubtasks(state, epicId).some((s) => s.status === SubtaskStatus.Failed);
}

/** Progress = qualified subtasks / target. */
export function epicProgress(state: AdminBoardState, epicId: string): { qualified: number; target: number } {
  const epic = state.epicsById[epicId];
  const qualified = epicSubtasks(state, epicId).filter((s) => s.status === SubtaskStatus.Qualified).length;
  return { qualified, target: epic?.target ?? 0 };
}

// ---- reducer ---------------------------------------------------------------

const gt = (a: string, b: string) => BigInt(a) > BigInt(b);

function buildFromBoard(board: InquiryBoardDto): Pick<AdminBoardState, 'epicsById' | 'epicOrder' | 'subtasksById' | 'lineage' | 'title' | 'inquiryState' | 'inquiryId'> {
  const epicsById: Record<string, EpicVM> = {};
  const epicOrder: string[] = [];
  const subtasksById: Record<string, SubtaskVM> = {};
  for (const e of board.epics ?? []) {
    const subtaskIds: string[] = [];
    for (const s of e.subtasks ?? []) {
      subtasksById[s.id] = { id: s.id, epicId: e.id, provider: s.subjectProviderName, wave: s.wave, status: s.status, qualityScore: s.qualityScore, personaId: s.personaId };
      subtaskIds.push(s.id);
    }
    epicsById[e.id] = { id: e.id, strategy: e.strategy, status: e.status, target: e.targetQualifiedOptions, releasedWaves: e.releasedWaves ?? [], subtaskIds };
    epicOrder.push(e.id);
  }
  const q = board.questionnaire;
  return {
    inquiryId: board.id,
    title: board.rawRequest,
    inquiryState: board.state,
    epicsById,
    epicOrder,
    subtasksById,
    lineage: {
      userRequest: board.rawRequest,
      initialResearch: board.subject?.title || board.subject?.description || 'Pre-research in progress…',
      confirmedScope: q?.confirmed ? 'Scope confirmed by the customer' : 'Awaiting customer confirmation',
    },
  };
}

/**
 * Admin live board (FE-10): one inquiry → epics → subtasks → findings + the agent
 * activity stream. Merges admin-room events idempotently (by event id), scoped to
 * the active inquiry; reconnect replays by cursor.
 */
export function adminBoardReducer(state: AdminBoardState, action: Action): AdminBoardState {
  switch (action.type) {
    case ActionType.AdminBoardLoaded:
      return { ...state, status: AsyncStatus.Ready, ...buildFromBoard(action.board) };

    case ActionType.EventReceived: {
      const e: InqiEvent = action.event;
      if (!state.inquiryId || e.inquiryId !== state.inquiryId) return state;
      if (state.seen[e.id]) return state;

      const seen = { ...state.seen, [e.id]: true as const };
      const cursor = gt(e.id, state.cursor) ? e.id : state.cursor;
      const item: BoardEventItem = { id: e.id, type: e.type, at: e.at, epicId: e.epicId, subtaskId: e.subtaskId, data: (e.data ?? {}) as Record<string, unknown> };
      const events = [...state.events, item].sort((a, b) => (gt(a.id, b.id) ? 1 : -1)).slice(-EVENT_CAP);

      let next: AdminBoardState = { ...state, seen, cursor, events };
      const d = item.data;

      switch (e.type) {
        case EventType.EpicCreated: {
          if (e.epicId && !next.epicsById[e.epicId]) {
            next = { ...next, epicsById: { ...next.epicsById, [e.epicId]: { id: e.epicId, strategy: String(d.strategy ?? ''), status: 'open', target: Number(d.target ?? 0), releasedWaves: [], subtaskIds: [] } }, epicOrder: [...next.epicOrder, e.epicId] };
          }
          break;
        }
        case EventType.SubtaskCreated: {
          if (e.subtaskId && e.epicId) {
            const st: SubtaskVM = { id: e.subtaskId, epicId: e.epicId, provider: String(d.subjectProviderName ?? ''), wave: Number(d.wave ?? 1), status: SubtaskStatus.Pending };
            const epic = next.epicsById[e.epicId];
            next = {
              ...next,
              subtasksById: { ...next.subtasksById, [e.subtaskId]: st },
              epicsById: epic ? { ...next.epicsById, [e.epicId]: { ...epic, subtaskIds: [...epic.subtaskIds, e.subtaskId] } } : next.epicsById,
            };
          }
          break;
        }
        case EventType.SubtaskUpdated: {
          const cur = e.subtaskId ? next.subtasksById[e.subtaskId] : undefined;
          if (cur) {
            next = { ...next, subtasksById: { ...next.subtasksById, [cur.id]: { ...cur, status: d.status ? String(d.status) : cur.status, qualityScore: typeof d.qualityScore === 'number' ? d.qualityScore : cur.qualityScore } } };
          }
          break;
        }
        case EventType.WaveReleased: {
          const epic = e.epicId ? next.epicsById[e.epicId] : undefined;
          const wave = Number(d.wave ?? 0);
          if (epic && wave && !epic.releasedWaves.includes(wave)) {
            next = { ...next, epicsById: { ...next.epicsById, [epic.id]: { ...epic, releasedWaves: [...epic.releasedWaves, wave] } } };
          }
          break;
        }
        case EventType.InquiryTransitioned: {
          if (d.to) next = { ...next, inquiryState: String(d.to) };
          break;
        }
        // FE-12: operator controls move the run state — reflect it in the board header.
        case EventType.InquiryPaused: { next = { ...next, inquiryState: InquiryState.ON_HOLD }; break; }
        case EventType.InquiryResumed: { if (d.to) next = { ...next, inquiryState: String(d.to) }; break; }
        case EventType.InquiryCancelled: { next = { ...next, inquiryState: InquiryState.CANCELLED }; break; }
        default: {
          // finding.added (forward-compat) + funnel.widened / run.reaped / agent.* → stream only.
          if ((e.type as string) === ReportEventType.FindingAdded) {
            const fid = String((d as { id?: string }).id ?? e.id);
            next = { ...next, findingsById: { ...next.findingsById, [fid]: { id: fid, subtaskId: e.subtaskId, kind: String((d as { kind?: string }).kind ?? 'finding') } } };
          }
        }
      }
      return next;
    }

    default:
      return state;
  }
}

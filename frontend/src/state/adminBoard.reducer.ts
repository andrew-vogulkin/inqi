import { EventType, InquiryStatus, ReportState, InqiEvent, QuestionnaireQuestion } from '@inqi/shared';
import { AsyncStatus, ReportEventType } from '../conventions/enums';
import { ReportBoardDto, SourceDto } from '../api/types';
import { Action, ActionType } from './actions';

const EVENT_CAP = 200;

export interface InquiryVM { id: string; epicId: string; provider: string; wave: number; status: string; qualityScore?: number | null; personaId?: string | null; researchPending?: boolean; sources: SourceDto[] }
export interface EpicVM { id: string; strategy: string; status: string; target: number; releasedWaves: number[]; inquiryIds: string[] }
export interface FindingVM { id: string; inquiryId?: string; kind: string }
export interface BoardEventItem { id: string; type: string; at: string; epicId?: string; inquiryId?: string; data: Record<string, unknown> }

export interface AdminBoardState {
  status: AsyncStatus;
  reportId: string | null;
  title: string;
  reportState: string;
  epicsById: Record<string, EpicVM>;
  epicOrder: string[];
  inquiriesById: Record<string, InquiryVM>;
  findingsById: Record<string, FindingVM>;
  lineage: { userRequest: string; initialResearch: string; confirmedScope: string };
  // The customer's confirmed scope Q&A (read-only), shown under lineage step 3.
  scope: { questions: QuestionnaireQuestion[]; answers: Record<string, string>; confirmed: boolean } | null;
  events: BoardEventItem[]; // agent activity stream
  cursor: string;
  seen: Record<string, true>;
}

export const initialAdminBoardState: AdminBoardState = {
  status: AsyncStatus.Idle,
  reportId: null,
  title: '',
  reportState: '',
  epicsById: {},
  epicOrder: [],
  inquiriesById: {},
  findingsById: {},
  lineage: { userRequest: '', initialResearch: '', confirmedScope: '' },
  scope: null,
  events: [],
  cursor: '0',
  seen: {},
};

// ---- pure selectors (unit-tested) -----------------------------------------

/** Inquiries of an epic, in insertion order. */
export function epicInquiries(state: AdminBoardState, epicId: string): InquiryVM[] {
  const epic = state.epicsById[epicId];
  return epic ? epic.inquiryIds.map((id) => state.inquiriesById[id]).filter(Boolean) : [];
}

/** "Need attention" = the epic has a failed inquiry (the real status for suspended/error). */
export function epicNeedsAttention(state: AdminBoardState, epicId: string): boolean {
  return epicInquiries(state, epicId).some((s) => s.status === InquiryStatus.Failed);
}

/** Progress = qualified inquiries / target. */
export function epicProgress(state: AdminBoardState, epicId: string): { qualified: number; target: number } {
  const epic = state.epicsById[epicId];
  const qualified = epicInquiries(state, epicId).filter((s) => s.status === InquiryStatus.Qualified).length;
  return { qualified, target: epic?.target ?? 0 };
}

// ---- reducer ---------------------------------------------------------------

const gt = (a: string, b: string) => BigInt(a) > BigInt(b);

function buildFromBoard(board: ReportBoardDto): Pick<AdminBoardState, 'epicsById' | 'epicOrder' | 'inquiriesById' | 'lineage' | 'scope' | 'title' | 'reportState' | 'reportId'> {
  const epicsById: Record<string, EpicVM> = {};
  const epicOrder: string[] = [];
  const inquiriesById: Record<string, InquiryVM> = {};
  for (const e of board.epics ?? []) {
    const inquiryIds: string[] = [];
    for (const s of e.inquiries ?? []) {
      // persona lives on the report (one voice per report) — denormalized onto each inquiry VM
      inquiriesById[s.id] = { id: s.id, epicId: e.id, provider: s.name, wave: s.wave, status: s.status, qualityScore: s.qualityScore, personaId: board.personaId, researchPending: s.researchPending ?? false, sources: s.sources ?? [] };
      inquiryIds.push(s.id);
    }
    epicsById[e.id] = { id: e.id, strategy: e.strategy, status: e.status, target: e.targetQualifiedOptions, releasedWaves: e.releasedWaves ?? [], inquiryIds };
    epicOrder.push(e.id);
  }
  const q = board.questionnaire;
  const questions = q?.questions ?? [];
  return {
    reportId: board.id,
    title: board.rawRequest,
    reportState: board.state,
    epicsById,
    epicOrder,
    inquiriesById,
    lineage: {
      userRequest: board.rawRequest,
      initialResearch: board.subject?.title || board.subject?.description || 'Pre-research in progress…',
      confirmedScope: q?.confirmed ? 'Scope confirmed by the customer' : 'Awaiting customer confirmation',
    },
    // Read-only scope Q&A for the operator — the questions with the customer's answers.
    scope: questions.length ? { questions, answers: q?.answers ?? {}, confirmed: !!q?.confirmed } : null,
  };
}

/**
 * Admin live board (FE-10): one report → epics → inquiries → findings + the agent
 * activity stream. Merges admin-room events idempotently (by event id), scoped to
 * the active report; reconnect replays by cursor.
 */
export function adminBoardReducer(state: AdminBoardState, action: Action): AdminBoardState {
  switch (action.type) {
    case ActionType.AdminBoardLoaded:
      return { ...state, status: AsyncStatus.Ready, ...buildFromBoard(action.board) };

    case ActionType.EventReceived: {
      const e: InqiEvent = action.event;
      if (!state.reportId || e.reportId !== state.reportId) return state;
      if (state.seen[e.id]) return state;

      const seen = { ...state.seen, [e.id]: true as const };
      const cursor = gt(e.id, state.cursor) ? e.id : state.cursor;
      const item: BoardEventItem = { id: e.id, type: e.type, at: e.at, epicId: e.epicId, inquiryId: e.inquiryId, data: (e.data ?? {}) as Record<string, unknown> };
      const events = [...state.events, item].sort((a, b) => (gt(a.id, b.id) ? 1 : -1)).slice(-EVENT_CAP);

      let next: AdminBoardState = { ...state, seen, cursor, events };
      const d = item.data;

      switch (e.type) {
        case EventType.EpicCreated: {
          if (e.epicId && !next.epicsById[e.epicId]) {
            next = { ...next, epicsById: { ...next.epicsById, [e.epicId]: { id: e.epicId, strategy: String(d.strategy ?? ''), status: 'open', target: Number(d.target ?? 0), releasedWaves: [], inquiryIds: [] } }, epicOrder: [...next.epicOrder, e.epicId] };
          }
          break;
        }
        case EventType.InquiryCreated: {
          if (e.inquiryId && e.epicId) {
            const st: InquiryVM = { id: e.inquiryId, epicId: e.epicId, provider: String(d.name ?? ''), wave: Number(d.wave ?? 1), status: InquiryStatus.Pending, researchPending: true, sources: [] };
            const epic = next.epicsById[e.epicId];
            next = {
              ...next,
              inquiriesById: { ...next.inquiriesById, [e.inquiryId]: st },
              epicsById: epic ? { ...next.epicsById, [e.epicId]: { ...epic, inquiryIds: [...epic.inquiryIds, e.inquiryId] } } : next.epicsById,
            };
          }
          break;
        }
        case EventType.InquiryUpdated: {
          const cur = e.inquiryId ? next.inquiriesById[e.inquiryId] : undefined;
          if (cur) {
            next = { ...next, inquiriesById: { ...next.inquiriesById, [cur.id]: { ...cur, status: d.status ? String(d.status) : cur.status, qualityScore: typeof d.qualityScore === 'number' ? d.qualityScore : cur.qualityScore, researchPending: typeof d.researchPending === 'boolean' ? d.researchPending : cur.researchPending } } };
          }
          break;
        }
        case EventType.SourceAdded: {
          // Depth tasks stream their found sources — append onto the inquiry VM (deduped by id).
          const cur = e.inquiryId ? next.inquiriesById[e.inquiryId] : undefined;
          const incoming = Array.isArray(d.sources) ? (d.sources as SourceDto[]) : [];
          if (cur && incoming.length) {
            const known = new Set(cur.sources.map((s) => s.id));
            const merged = [...cur.sources, ...incoming.filter((s) => s && !known.has(s.id))];
            next = { ...next, inquiriesById: { ...next.inquiriesById, [cur.id]: { ...cur, sources: merged } } };
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
        case EventType.ReportTransitioned: {
          if (d.to) next = { ...next, reportState: String(d.to) };
          break;
        }
        // FE-12: operator controls move the run state — reflect it in the board header.
        case EventType.ReportPaused: { next = { ...next, reportState: ReportState.ON_HOLD }; break; }
        case EventType.ReportResumed: { if (d.to) next = { ...next, reportState: String(d.to) }; break; }
        case EventType.ReportCancelled: { next = { ...next, reportState: ReportState.CANCELLED }; break; }
        default: {
          // finding.added (forward-compat) + funnel.widened / run.reaped / agent.* → stream only.
          if ((e.type as string) === ReportEventType.FindingAdded) {
            const fid = String((d as { id?: string }).id ?? e.id);
            next = { ...next, findingsById: { ...next.findingsById, [fid]: { id: fid, inquiryId: e.inquiryId, kind: String((d as { kind?: string }).kind ?? 'finding') } } };
          }
        }
      }
      return next;
    }

    default:
      return state;
  }
}

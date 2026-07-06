import { EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus, ReportEventType, FreemiumState } from '../conventions/enums';
import { rankOptions, optionId, RankedOption } from '../conventions/ranking';
import { ReportOption, LiveReportDto } from '../api/types';
import { Action, ActionType } from './actions';

const TIMELINE_CAP = 200;

export interface TimelineItem { id: string; type: string; at: string; data: Record<string, unknown> }

export interface ReportState {
  status: AsyncStatus;
  reportId: string | null;
  ref: string | null; // human-facing reference (RPT-YYMMDD-NN)
  personaId: string | null;
  reportState: string;
  rawRequest: string;
  focus: string | null; // ranking priority the customer picked (price | quality)
  summary: string;
  delivered: boolean;
  reusedFrom: string | null;
  snapshotToken: string | null;
  snapshotId: string | null;  // HP-21: the snapshot id (for POST /reports/:id/unlock)
  optionsById: Record<string, RankedOption>;
  order: string[];          // ranked option ids (best first)
  freemium: boolean;        // FE-07: report is gated (top options redacted)
  freemiumState: FreemiumState;
  error: string | null;
  timeline: TimelineItem[]; // streamed events, sorted by id, deduped
  cursor: string;           // max event id seen (replay-by-cursor)
  seen: Record<string, true>;
}

export const initialReportState: ReportState = {
  status: AsyncStatus.Idle,
  reportId: null,
  ref: null,
  personaId: null,
  reportState: '',
  rawRequest: '',
  focus: null,
  summary: '',
  delivered: false,
  reusedFrom: null,
  snapshotToken: null,
  snapshotId: null,
  optionsById: {},
  order: [],
  freemium: false,
  freemiumState: FreemiumState.Locked,
  error: null,
  timeline: [],
  cursor: '0',
  seen: {},
};

// ---- pure helpers (unit-tested) -------------------------------------------

function reindex(optionsById: Record<string, RankedOption>): { optionsById: Record<string, RankedOption>; order: string[] } {
  const ranked = rankOptions(Object.values(optionsById));
  const next: Record<string, RankedOption> = {};
  for (const o of ranked) next[optionId(o)] = o;
  return { optionsById: next, order: ranked.map(optionId) };
}

/** Upsert options (by id) and re-rank. Used by both snapshot merge and finding events. */
export function upsertOptions({ optionsById, incoming }: { optionsById: Record<string, RankedOption>; incoming: ReportOption[] }): { optionsById: Record<string, RankedOption>; order: string[] } {
  const merged: Record<string, RankedOption> = { ...optionsById };
  for (const o of incoming) merged[optionId(o)] = { ...(merged[optionId(o)] ?? {}), ...o } as RankedOption;
  return reindex(merged);
}

const gt = (a: string, b: string) => BigInt(a) > BigInt(b);

/**
 * Order options. When freemium and still locked, preserve the server rank order
 * (locked rows can't be blended-ranked client-side — they carry no scores); once
 * unlocked / non-freemium, re-rank by the blended score.
 */
function buildOptions({ incoming, locked }: { incoming: ReportOption[]; locked: boolean }): { optionsById: Record<string, RankedOption>; order: string[] } {
  if (locked) {
    const sorted = [...incoming].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    const optionsById: Record<string, RankedOption> = {};
    const order: string[] = [];
    for (const o of sorted) { const id = optionId(o); optionsById[id] = o as RankedOption; order.push(id); }
    return { optionsById, order };
  }
  return reindex(Object.fromEntries(incoming.map((o) => [optionId(o), o as RankedOption])));
}

/** The current best match (top-ranked option), or null. */
export function bestMatch(state: ReportState): RankedOption | null {
  return state.order.length ? state.optionsById[state.order[0]] : null;
}

/** Freemium view (FE-07): the redacted locked rows + the revealed taster, in order. */
export function freemiumView(state: ReportState): { locked: RankedOption[]; revealed: RankedOption[] } {
  const opts = state.order.map((id) => state.optionsById[id]);
  return { locked: opts.filter((o) => o.locked), revealed: opts.filter((o) => !o.locked) };
}

// ---- reducer ---------------------------------------------------------------

/**
 * Live report (FE-06). Snapshot-then-stream: REST snapshot seeds options/state, then
 * realtime events apply idempotently + out-of-order-safe (by event id) into the
 * timeline + state, upserting options and re-ranking live.
 */
export function reportReducer(state: ReportState, action: Action): ReportState {
  switch (action.type) {
    case ActionType.ReportSnapshotReceived: {
      const live: LiveReportDto = action.live;
      const freemium = live.freemium ?? false;
      // Non-freemium → fully shown. Freemium → keep Locked unless we'd already
      // unlocked (so a re-fetched snapshot after unlock stays revealed).
      const freemiumState = !freemium
        ? FreemiumState.Unlocked
        : state.freemiumState === FreemiumState.Unlocked ? FreemiumState.Unlocked
        : state.freemiumState === FreemiumState.Unlocking ? FreemiumState.Unlocking
        : FreemiumState.Locked;
      const locked = freemium && freemiumState !== FreemiumState.Unlocked;
      const { optionsById, order } = buildOptions({ incoming: live.options ?? [], locked });
      return {
        ...state,
        status: AsyncStatus.Ready,
        reportId: live.reportId,
        ref: live.ref ?? null,
        personaId: live.personaId ?? null,
        reportState: live.state,
        rawRequest: live.rawRequest,
        focus: live.focus ?? null,
        summary: live.summary,
        delivered: live.delivered,
        reusedFrom: live.reusedFrom,
        snapshotToken: live.snapshotToken,
        snapshotId: live.snapshotId ?? null,
        freemium,
        freemiumState,
        optionsById,
        order,
      };
    }

    case ActionType.UnlockStarted:
      return state.freemiumState === FreemiumState.Locked ? { ...state, freemiumState: FreemiumState.Unlocking, error: null } : state;

    case ActionType.UnlockFailed:
      return { ...state, freemiumState: FreemiumState.Locked, error: action.message };

    case ActionType.EventReceived: {
      const e: InqiEvent = action.event;
      if (!state.reportId || e.reportId !== state.reportId) return state;
      if (state.seen[e.id]) return state; // idempotent

      const seen = { ...state.seen, [e.id]: true as const };
      const cursor = gt(e.id, state.cursor) ? e.id : state.cursor;
      const item: TimelineItem = { id: e.id, type: e.type, at: e.at, data: (e.data ?? {}) as Record<string, unknown> };
      const timeline = [...state.timeline, item].sort((a, b) => (gt(a.id, b.id) ? 1 : -1)).slice(-TIMELINE_CAP);

      let next: ReportState = { ...state, seen, cursor, timeline };

      const type = e.type as string; // events may carry forward-looking types beyond the shared union
      if (type === EventType.ReportTransitioned) {
        const to = (e.data as { to?: string })?.to;
        if (to) next = { ...next, reportState: to };
      } else if (type === EventType.SnapshotReady) {
        const token = (e.data as { snapshotToken?: string })?.snapshotToken ?? next.snapshotToken;
        next = { ...next, delivered: true, snapshotToken: token };
      } else if (type === ReportEventType.FindingAdded || type === ReportEventType.SnapshotUpdated) {
        const data = e.data as { option?: ReportOption; options?: ReportOption[] };
        const incoming = data.options ?? (data.option ? [data.option] : []);
        if (incoming.length) { const { optionsById, order } = upsertOptions({ optionsById: next.optionsById, incoming }); next = { ...next, optionsById, order }; }
      }
      return next;
    }

    case ActionType.ReportCleared:
      return initialReportState;

    default:
      return state;
  }
}

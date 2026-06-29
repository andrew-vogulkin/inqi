import { EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus, ReportEventType, FreemiumState } from '../conventions/enums';
import { rankOptions, optionId, RankedOption } from '../conventions/ranking';
import { ReportOption, LiveReportDto } from '../api/types';
import { Action, ActionType } from './actions';

const TIMELINE_CAP = 200;

export interface TimelineItem { id: string; type: string; at: string; data: Record<string, unknown> }

export interface ReportState {
  status: AsyncStatus;
  inquiryId: string | null;
  inquiryState: string;
  rawRequest: string;
  summary: string;
  delivered: boolean;
  reusedFrom: string | null;
  reportToken: string | null;
  reportId: string | null;  // HP-21: the snapshot id (for POST /reports/:id/unlock)
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
  inquiryId: null,
  inquiryState: '',
  rawRequest: '',
  summary: '',
  delivered: false,
  reusedFrom: null,
  reportToken: null,
  reportId: null,
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
export function upsertOptions(optionsById: Record<string, RankedOption>, incoming: ReportOption[]): { optionsById: Record<string, RankedOption>; order: string[] } {
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
        inquiryId: live.inquiryId,
        inquiryState: live.state,
        rawRequest: live.rawRequest,
        summary: live.summary,
        delivered: live.delivered,
        reusedFrom: live.reusedFrom,
        reportToken: live.reportToken,
        reportId: live.reportId ?? null,
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
      if (!state.inquiryId || e.inquiryId !== state.inquiryId) return state;
      if (state.seen[e.id]) return state; // idempotent

      const seen = { ...state.seen, [e.id]: true as const };
      const cursor = gt(e.id, state.cursor) ? e.id : state.cursor;
      const item: TimelineItem = { id: e.id, type: e.type, at: e.at, data: (e.data ?? {}) as Record<string, unknown> };
      const timeline = [...state.timeline, item].sort((a, b) => (gt(a.id, b.id) ? 1 : -1)).slice(-TIMELINE_CAP);

      let next: ReportState = { ...state, seen, cursor, timeline };

      const type = e.type as string; // events may carry forward-looking types beyond the shared union
      if (type === EventType.InquiryTransitioned) {
        const to = (e.data as { to?: string })?.to;
        if (to) next = { ...next, inquiryState: to };
      } else if (type === EventType.ReportReady) {
        const token = (e.data as { reportToken?: string })?.reportToken ?? next.reportToken;
        next = { ...next, delivered: true, reportToken: token };
      } else if (type === ReportEventType.FindingAdded || type === ReportEventType.ReportUpdated) {
        const data = e.data as { option?: ReportOption; options?: ReportOption[] };
        const incoming = data.options ?? (data.option ? [data.option] : []);
        if (incoming.length) { const { optionsById, order } = upsertOptions(next.optionsById, incoming); next = { ...next, optionsById, order }; }
      }
      return next;
    }

    case ActionType.ReportCleared:
      return initialReportState;

    default:
      return state;
  }
}

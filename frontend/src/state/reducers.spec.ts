import { describe, it, expect } from 'vitest';
import { AuthRole, EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus, AuthState, ToastKind } from '../conventions/enums';
import { StoredSession } from '../conventions/session-storage';
import { ActionType } from './actions';
import { sessionReducer, initialSessionState } from './session.reducer';
import { creditsReducer, initialCreditsState } from './credits.reducer';
import { reportsReducer, initialReportsState } from './reports.reducer';
import { toastsReducer, initialToastsState } from './toasts.reducer';
import { ReportDto } from '../api/types';

const session: StoredSession = { token: 't', customer: { id: 'c1', email: 'a@b.com', role: AuthRole.Customer } };
const evt = (over: Partial<InqiEvent>): InqiEvent => ({ id: '1', type: EventType.AgentProgress, reportId: 'i1', at: '2026-06-29T00:00:00Z', data: {}, ...over });
const inq = (over: Partial<ReportDto> = {}): ReportDto => ({ id: 'i1', rawRequest: 'a bike', state: 'OUTREACH', customerEmail: 'a@b.com', createdAt: 'now', ...over });

describe('sessionReducer', () => {
  it('signs in and out', () => {
    const s = sessionReducer(initialSessionState, { type: ActionType.SignedIn, session });
    expect(s.session?.customer.id).toBe('c1');
    expect(s.authState).toBe(AuthState.SignedOut);
    expect(sessionReducer(s, { type: ActionType.SignedOut }).session).toBeNull();
  });
  it('tracks the sign-in flow: signing-in → error → success clears error', () => {
    let s = sessionReducer(initialSessionState, { type: ActionType.SignInStarted });
    expect(s.authState).toBe(AuthState.SigningIn);
    s = sessionReducer(s, { type: ActionType.SignInFailed, message: 'nope' });
    expect(s).toMatchObject({ authState: AuthState.Error, error: 'nope' });
    s = sessionReducer(s, { type: ActionType.SignedIn, session });
    expect(s).toMatchObject({ authState: AuthState.SignedOut, error: null });
    expect(s.session?.customer.email).toBe('a@b.com');
  });
  it('two-step flow: CodeSent stores the pending email; a wrong code keeps it; success clears it', () => {
    let s = sessionReducer(initialSessionState, { type: ActionType.SignInStarted });
    s = sessionReducer(s, { type: ActionType.CodeSent, email: 'a@b.com' });
    expect(s).toMatchObject({ authState: AuthState.CodeSent, pendingEmail: 'a@b.com', error: null });
    s = sessionReducer(s, { type: ActionType.SignInFailed, message: 'bad code' });
    expect(s.pendingEmail).toBe('a@b.com'); // the code step re-shows for the same address
    s = sessionReducer(s, { type: ActionType.SignedIn, session });
    expect(s.pendingEmail).toBeNull();
  });
});

describe('creditsReducer', () => {
  it('loads balance + history (newest-first)', () => {
    const s = creditsReducer(initialCreditsState, {
      type: ActionType.CreditsLoaded, balance: 3,
      history: [
        { id: 'a', kind: 'topup', amount: 5, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'b', kind: 'reserve', amount: 1, createdAt: '2026-03-01T00:00:00Z' },
      ],
    });
    expect(s).toMatchObject({ status: AsyncStatus.Ready, balance: 3 });
    expect(s.history.map((h) => h.id)).toEqual(['b', 'a']); // sorted newest-first
  });
  it('refresh sets Loading before data arrives', () => {
    expect(creditsReducer(initialCreditsState, { type: ActionType.CreditsLoading }).status).toBe(AsyncStatus.Loading);
  });
  it('a top-up request (toast) produces NO balance delta', () => {
    const loaded = creditsReducer(initialCreditsState, { type: ActionType.CreditsLoaded, balance: 2, history: [] });
    const after = creditsReducer(loaded, { type: ActionType.ToastPushed, toast: { id: 't', kind: ToastKind.Success, message: 'requested' } });
    expect(after.balance).toBe(2);
  });
  it('a credit event sets the balance ABSOLUTELY from its payload (never a delta)', () => {
    let s = creditsReducer({ ...initialCreditsState, balance: 5 }, { type: ActionType.EventReceived, event: evt({ type: EventType.CreditsCharged, data: { amount: 1, balance: 4 } }) });
    expect(s.balance).toBe(4);
    s = creditsReducer(s, { type: ActionType.EventReceived, event: evt({ type: EventType.CreditsRefunded, at: '2026-06-29T00:01:00Z', data: { amount: 1, balance: 5 } }) });
    expect(s.balance).toBe(5);
  });
  it('ignores events without a balance payload — replayed history must not compound as deltas', () => {
    const loaded = creditsReducer(initialCreditsState, { type: ActionType.CreditsLoaded, balance: 3, history: [] });
    const s = creditsReducer(loaded, { type: ActionType.EventReceived, event: evt({ type: EventType.CreditsCharged, data: { amount: 1 } }) });
    expect(s.balance).toBe(3); // NOT 2 — the snapshot already includes every past charge
  });
  it('ignores events at/behind the snapshot watermark (the dashboard replays full report histories)', () => {
    const loaded = creditsReducer(initialCreditsState, {
      type: ActionType.CreditsLoaded, balance: 3,
      history: [{ id: 'a', kind: 'charge', amount: 1, createdAt: '2026-07-01T00:00:00Z' }],
    });
    // A replayed historical charge (older than the snapshot) carries a then-current balance — stale, ignored.
    let s = creditsReducer(loaded, { type: ActionType.EventReceived, event: evt({ type: EventType.CreditsCharged, at: '2026-06-30T00:00:00Z', data: { amount: 1, balance: 9 } }) });
    expect(s.balance).toBe(3);
    // A genuinely NEW charge (after the watermark) moves it.
    s = creditsReducer(s, { type: ActionType.EventReceived, event: evt({ type: EventType.CreditsCharged, at: '2026-07-02T00:00:00Z', data: { amount: 1, balance: 2 } }) });
    expect(s.balance).toBe(2);
    // ...and the SAME event replayed again is now at the watermark: no double-apply.
    s = creditsReducer(s, { type: ActionType.EventReceived, event: evt({ type: EventType.CreditsCharged, at: '2026-07-02T00:00:00Z', data: { amount: 1, balance: 2 } }) });
    expect(s.balance).toBe(2);
  });
});

describe('reportsReducer', () => {
  it('indexes loaded reports and updates state on a transition event', () => {
    let s = reportsReducer(initialReportsState, { type: ActionType.ReportsLoaded, reports: [inq()] });
    expect(s.order).toEqual(['i1']);
    s = reportsReducer(s, { type: ActionType.EventReceived, event: evt({ type: EventType.ReportTransitioned, data: { from: 'OUTREACH', to: 'REPORT_DELIVERED' } }) });
    expect(s.byId.i1.state).toBe('REPORT_DELIVERED');
  });
  it('ignores transition events for unknown reports', () => {
    const s = reportsReducer(initialReportsState, { type: ActionType.EventReceived, event: evt({ type: EventType.ReportTransitioned, reportId: 'ghost', data: { to: 'X' } }) });
    expect(s).toEqual(initialReportsState);
  });
});

describe('toastsReducer', () => {
  it('pushes and dismisses', () => {
    let s = toastsReducer(initialToastsState, { type: ActionType.ToastPushed, toast: { id: 'x', kind: ToastKind.Success, message: 'ok' } });
    expect(s.items).toHaveLength(1);
    expect(toastsReducer(s, { type: ActionType.ToastDismissed, id: 'x' }).items).toHaveLength(0);
  });
  it('reconnect makes a deterministic "no events missed" toast', () => {
    const s = toastsReducer(initialToastsState, { type: ActionType.SocketReconnected });
    expect(s.items[0]).toMatchObject({ id: 'reconnect-0', kind: ToastKind.Info });
    expect(s.items[0].message).toContain('no events missed');
  });
});

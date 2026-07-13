import { ReactNode, UIEvent, useEffect, useRef, useState } from 'react';
import { AccountStatus, AuthRole } from '@inqi/shared';
import { AsyncStatus, StatusTone, ToastKind, ButtonVariant } from '../conventions/enums';
import { Route } from '../conventions/routes';
import { REPORT_SEARCH_DEBOUNCE_MS, nearListEnd } from '../conventions/report-picker';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { adminApi } from '../api';
import { UserRowDto } from '../api/types';
import { Badge, Button, ConfirmDialog, MonoRef, Skeleton } from '../ui';
import { toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

/**
 * FE-18 (HP-25) — the admin user directory. Every account, **alphabetical by email**,
 * with registration date, role and active/suspended status; type to search, scroll to
 * page. Select a row to open its detail panel and suspend / reactivate the account
 * (self + admin rows are protected) or jump to that user's reports.
 */

const STATUS_FILTERS: { key: string; label: string; value?: AccountStatus }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active', value: AccountStatus.Active },
  { key: 'suspended', label: 'Suspended', value: AccountStatus.Suspended },
];

const statusTone = (s: AccountStatus): StatusTone => (s === AccountStatus.Suspended ? StatusTone.Danger : StatusTone.Muted);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

export function AdminUsers() {
  const dispatch = useAppDispatch();
  const meId = useSelector((s) => s.session.session?.customer.id) ?? null;

  const [status, setStatus] = useState<AsyncStatus>(AsyncStatus.Loading);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AccountStatus | undefined>(undefined);
  const [rows, setRows] = useState<UserRowDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0); // stale-response guard: only the latest search commits

  async function fetchPage({ q, sf, cursor }: { q: string; sf?: AccountStatus; cursor?: string }) {
    const mySeq = ++seq.current;
    if (cursor) setLoadingMore(true); else setStatus(AsyncStatus.Loading);
    try {
      const page = await adminApi.searchUsers({ q, status: sf, cursor });
      if (mySeq !== seq.current) return;
      setRows((prev) => (cursor ? mergeUsers(prev, page.rows) : page.rows));
      setNextCursor(page.nextCursor);
      setStatus(AsyncStatus.Ready);
    } catch {
      if (mySeq === seq.current && !cursor) setStatus(AsyncStatus.Error);
    } finally {
      if (mySeq === seq.current) setLoadingMore(false);
    }
  }

  // Debounced search whenever the query or the status filter changes (initial load included).
  useEffect(() => {
    const t = setTimeout(() => { void fetchPage({ q: query, sf: statusFilter }); }, REPORT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, statusFilter]);

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (!loadingMore && nextCursor && nearListEnd({ scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight })) {
      void fetchPage({ q: query, sf: statusFilter, cursor: nextCursor });
    }
  }

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const protectedRow = !!selected && (selected.id === meId || selected.role === AuthRole.Admin);

  function replaceRow(updated: UserRowDto) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function doSuspend() {
    if (!selected) return;
    setConfirmOpen(false);
    setBusy(true);
    try {
      const updated = await adminApi.suspendUser({ id: selected.id });
      replaceRow(updated);
      dispatch({ type: ActionType.ToastPushed, toast: { id: `susp-${updated.id}-${updated.suspendedAt}`, kind: ToastKind.Success, message: `${updated.email} suspended.` } });
    } catch {
      dispatch({ type: ActionType.ToastPushed, toast: { id: `susp-err-${selected.id}`, kind: ToastKind.Danger, message: `Couldn't suspend ${selected.email}.` } });
    } finally {
      setBusy(false);
    }
  }

  async function doReactivate() {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await adminApi.reactivateUser({ id: selected.id });
      replaceRow(updated);
      dispatch({ type: ActionType.ToastPushed, toast: { id: `react-${updated.id}`, kind: ToastKind.Success, message: `${updated.email} reactivated.` } });
    } catch {
      dispatch({ type: ActionType.ToastPushed, toast: { id: `react-err-${selected.id}`, kind: ToastKind.Danger, message: `Couldn't reactivate ${selected.email}.` } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: space[4] }} data-testid="admin-users">
      <header style={{ display: 'flex', alignItems: 'center', gap: space[3], flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: fontSize.h2, margin: 0 }}>Users</h1>
        <span style={{ fontSize: fontSize.sm, color: color.subtle }}>{rows.length}{nextCursor ? '+' : ''} shown</span>
        <input
          data-testid="user-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search email or name…"
          style={{ marginLeft: 'auto', width: 260, height: 36, padding: '0 12px', border: `1.5px solid ${color.lineStrong}`, borderRadius: radius.md, fontSize: fontSize.base, fontFamily: font.ui, color: color.ink, background: color.surface, outline: 'none' }}
        />
        <div role="tablist" style={{ display: 'flex', gap: 4 }}>
          {STATUS_FILTERS.map((f) => {
            const on = statusFilter === f.value;
            return (
              <button key={f.key} data-testid={`status-filter-${f.key}`} onClick={() => setStatusFilter(f.value)}
                style={{ padding: '6px 12px', borderRadius: radius.md, border: `1px solid ${on ? color.ink : color.line}`, background: on ? color.ink : color.surface, color: on ? color.onSolid : color.muted, fontSize: fontSize.sm, fontWeight: on ? fontWeight.semibold : fontWeight.regular, cursor: 'pointer' }}>
                {f.label}
              </button>
            );
          })}
        </div>
      </header>

      <div style={{ display: 'flex', gap: space[4], alignItems: 'flex-start' }}>
        {/* the table */}
        <div style={{ flex: 1, minWidth: 0, border: `1px solid ${color.line}`, borderRadius: radius.lg, background: color.surface, overflow: 'hidden' }}>
          <div data-testid="user-table-scroll" onScroll={onScroll} style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', overflowX: 'auto' }}>
            <table data-testid="user-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm }}>
              <thead>
                <tr style={{ textAlign: 'left', color: color.muted, position: 'sticky', top: 0, background: color.surface, zIndex: 1 }}>
                  <Th>Email</Th><Th>Registered</Th><Th>Role</Th><Th>Status</Th><Th right>Reports</Th>
                </tr>
              </thead>
              <tbody>
                {status === AsyncStatus.Ready && rows.map((u) => {
                  const on = u.id === selectedId;
                  const tone = toneColors[statusTone(u.status)];
                  return (
                    <tr key={u.id} data-testid="user-row" onClick={() => setSelectedId(u.id)} aria-selected={on}
                      style={{ borderTop: `1px solid ${color.line}`, cursor: 'pointer', background: on ? color.brandTint : 'transparent' }}>
                      <Td><span style={{ fontWeight: fontWeight.medium, color: color.ink }}>{u.email}</span>{u.name ? <span style={{ color: color.subtle }}> · {u.name}</span> : null}</Td>
                      <Td><span style={{ color: color.muted, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(u.registeredAt)}</span></Td>
                      <Td>{u.role === AuthRole.Admin ? <Badge tone={StatusTone.Info}>admin</Badge> : <span style={{ color: color.subtle }}>customer</span>}</Td>
                      <Td><span data-testid="user-status-pill" style={{ fontSize: fontSize.xs, fontWeight: fontWeight.semibold, padding: '2px 8px', borderRadius: radius.pill, background: tone.bg, color: tone.fg }}>{u.status}</span></Td>
                      <Td right><MonoRef>{u.reportCount}</MonoRef></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {status === AsyncStatus.Loading && <div style={{ padding: space[3] }}><Skeleton width="60%" /><div style={{ height: space[2] }} /><Skeleton width="45%" /></div>}
            {status === AsyncStatus.Ready && rows.length === 0 && (
              <div data-testid="user-empty" style={{ padding: '28px 12px', textAlign: 'center', color: color.subtle, fontSize: fontSize.sm }}>
                {query ? `No users match “${query}”.` : 'No users yet.'}
              </div>
            )}
            {status === AsyncStatus.Error && (
              <div data-testid="user-error" style={{ padding: '28px 12px', textAlign: 'center', color: color.danger, fontSize: fontSize.sm }}>Couldn't load users.</div>
            )}
            {loadingMore && <div style={{ padding: '10px', textAlign: 'center', color: color.subtle, fontSize: fontSize.xs }}>Loading…</div>}
          </div>
        </div>

        {/* the detail / action panel */}
        <aside data-testid="user-detail-panel" style={{ width: 300, flex: 'none', position: 'sticky', top: space[4], border: `1px solid ${color.line}`, borderRadius: radius.lg, background: color.surface, padding: space[4] }}>
          {!selected ? (
            <div style={{ color: color.subtle, fontSize: fontSize.sm }}>Select a user to view details and manage their account.</div>
          ) : (
            <div style={{ display: 'grid', gap: space[3] }}>
              <div>
                <div style={{ fontWeight: fontWeight.semibold, color: color.ink, wordBreak: 'break-all' }}>{selected.email}</div>
                {selected.name && <div style={{ fontSize: fontSize.sm, color: color.muted }}>{selected.name}</div>}
              </div>
              <Field label="Status">
                <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
                {selected.suspendedAt && <span style={{ fontSize: fontSize.xs, color: color.subtle, marginLeft: 6 }}>since {fmtDate(selected.suspendedAt)}</span>}
              </Field>
              <Field label="Role">{selected.role}</Field>
              <Field label="Registered">{fmtDate(selected.registeredAt)}</Field>
              <Field label="Credits"><MonoRef>{selected.credits}</MonoRef></Field>
              <Field label="Reports"><MonoRef>{selected.reportCount}</MonoRef></Field>

              <a data-testid="view-reports-link" href={`#${Route.Admin}?q=${encodeURIComponent(selected.email)}`}
                style={{ fontSize: fontSize.sm, color: color.brand }}>
                View this user's reports →
              </a>

              <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: space[3] }}>
                {protectedRow ? (
                  <div data-testid="protected-note" style={{ fontSize: fontSize.xs, color: color.subtle }}>
                    {selected.id === meId ? 'You cannot suspend your own account.' : 'Admin accounts cannot be suspended.'}
                  </div>
                ) : selected.status === AccountStatus.Suspended ? (
                  <Button variant={ButtonVariant.Primary} full disabled={busy} onClick={doReactivate} testId="reactivate-button">Reactivate account</Button>
                ) : (
                  <Button variant={ButtonVariant.Danger} full disabled={busy} onClick={() => setConfirmOpen(true)} testId="suspend-button">Suspend account</Button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Suspend account?"
        message={selected ? `${selected.email} will be signed out and blocked from using inqi until reactivated.` : ''}
        confirmLabel="Suspend"
        danger
        onConfirm={doSuspend}
        onCancel={() => setConfirmOpen(false)}
        confirmTestId="suspend-confirm"
        cancelTestId="suspend-cancel"
      />
    </div>
  );
}

/** Append a page, deduping by id — the alphabetical cursor window can resend a row. */
function mergeUsers(prev: UserRowDto[], page: UserRowDto[]): UserRowDto[] {
  const seen = new Set(prev.map((r) => r.id));
  return [...prev, ...page.filter((r) => !seen.has(r.id))];
}

function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th style={{ padding: `${space[2]}px ${space[3]}px`, textAlign: right ? 'right' : 'left', fontWeight: fontWeight.medium, fontSize: fontSize.xs, textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</th>;
}
function Td({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <td style={{ padding: `${space[2]}px ${space[3]}px`, textAlign: right ? 'right' : 'left' }}>{children}</td>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
      <span style={{ fontSize: fontSize.xs, color: color.subtle, width: 74, flex: 'none' }}>{label}</span>
      <span style={{ fontSize: fontSize.sm, color: color.ink }}>{children}</span>
    </div>
  );
}

import { CSSProperties, useEffect, useState } from 'react';
import { color, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { relativeTime } from '../conventions/credits';
import { adminApi, ApiError } from '../api';
import { CustomerDirectoryDto, CreditRequestDto } from '../api/types';
import { Button, Input } from '../ui';

const CARD: CSSProperties = { background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xl, padding: '22px 24px' };
const LABEL: CSSProperties = { display: 'block', fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.subtle, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 10 };

const SEARCH_DEBOUNCE_MS = 250;

/**
 * FE-16 — operator credit top-up (HP-19/22). Search customers by partial
 * email / name (GET /admin/customers?q=), pick one, grant a positive integer
 * amount with an optional note (POST /admin/customers/:id/credits — audited).
 */
export function CreditTopup() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CustomerDirectoryDto[] | null>(null); // null = nothing searched yet
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CustomerDirectoryDto | null>(null);
  const [amount, setAmount] = useState('5');
  const [note, setNote] = useState('');
  const [granting, setGranting] = useState(false);
  const [granted, setGranted] = useState<{ email: string; amount: number; balance: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pending credit requests (the operator queue) — approve grants, reject closes it.
  const [requests, setRequests] = useState<CreditRequestDto[] | null>(null); // null = loading
  const [busyReq, setBusyReq] = useState<string | null>(null); // request id being resolved

  useEffect(() => { adminApi.listCreditRequests().then(setRequests).catch(() => setRequests([])); }, []);

  async function resolveRequest(r: CreditRequestDto, action: 'approve' | 'reject') {
    setBusyReq(r.id);
    setError(null);
    try {
      if (action === 'approve') {
        const res = await adminApi.approveCreditRequest({ id: r.id });
        setGranted({ email: r.email, amount: r.amount, balance: res.balance });
      } else {
        await adminApi.rejectCreditRequest({ id: r.id });
      }
      setRequests((cur) => (cur ?? []).filter((x) => x.id !== r.id)); // drop the resolved row
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Could not ${action} the request — try again.`);
    } finally {
      setBusyReq(null);
    }
  }

  // Debounced partial-keyword search against the admin directory.
  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      adminApi.searchCustomers({ q: query })
        .then((rows) => { setResults(rows); setError(null); })
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Search failed — try again.'))
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && amountNum > 0;

  async function grant() {
    if (!selected || !amountValid) return;
    setGranting(true);
    setError(null);
    try {
      const r = await adminApi.topUp({ customerId: selected.id, amount: amountNum, note: note.trim() || undefined });
      setGranted({ email: selected.email, amount: amountNum, balance: r.balance });
      setSelected(null);
      setQ('');
      setResults(null);
      setNote('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Top-up failed — try again.');
    } finally {
      setGranting(false);
    }
  }

  return (
    <div data-testid="credit-topup" style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: 21, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 4px' }}>Credit top-up</h1>
      <p style={{ fontSize: fontSize.base, color: color.muted, margin: '0 0 18px' }}>Grant credits to a customer account while inqi is in early access.</p>

      {granted && (
        <div data-testid="topup-success" style={{ ...CARD, borderColor: color.brandTint, background: color.brandTint, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: fontSize.base }}>✓</span>
          <div style={{ fontSize: 13, color: color.ink }}>
            Granted <b>{granted.amount}</b> credit{granted.amount === 1 ? '' : 's'} to <b>{granted.email}</b> — new balance <b data-testid="new-balance">{granted.balance}</b>.
          </div>
        </div>
      )}
      {error && (
        <div data-testid="topup-error" role="alert" style={{ ...CARD, borderColor: color.dangerTint, background: color.dangerTint, marginBottom: 14, fontSize: 13, color: color.ink }}>
          {error}
        </div>
      )}

      {/* Pending credit requests — approve grants the requested amount, reject closes it. */}
      <div data-testid="credit-requests" style={{ ...CARD, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: requests && requests.length ? 14 : 0 }}>
          <label style={{ ...LABEL, marginBottom: 0 }}>Credit requests</label>
          {requests && <span style={{ fontSize: 11, color: color.subtle, background: color.appBg, borderRadius: radius.pill, padding: '2px 8px' }}>{requests.length} pending</span>}
        </div>
        {requests === null && <div style={{ fontSize: fontSize.sm, color: color.subtle }}>Loading…</div>}
        {requests && requests.length === 0 && <div data-testid="no-requests" style={{ fontSize: fontSize.base, color: color.muted }}>No pending requests.</div>}
        {requests && requests.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requests.map((r) => (
              <li key={r.id} data-testid="credit-request" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: radius.lg, border: `1px solid ${color.surfaceAlt}`, background: color.appBg }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: color.ink, fontWeight: fontWeight.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.email} · <b style={{ fontFamily: font.mono }}>{r.amount}</b> credit{r.amount === 1 ? '' : 's'}
                  </div>
                  <div style={{ fontSize: fontSize.xs, color: color.subtle }}>{relativeTime({ iso: r.createdAt, now: Date.now() })}{r.note ? ` · ${r.note}` : ''}</div>
                </div>
                <button data-testid="approve-request" disabled={busyReq === r.id} onClick={() => resolveRequest(r, 'approve')}
                  style={{ height: 32, padding: '0 12px', borderRadius: radius.md, border: 'none', background: color.brand, color: color.onSolid, fontSize: fontSize.sm, fontWeight: fontWeight.medium, cursor: busyReq ? 'default' : 'pointer', opacity: busyReq === r.id ? 0.6 : 1 }}>
                  {busyReq === r.id ? '…' : `Approve +${r.amount}`}
                </button>
                <button data-testid="reject-request" disabled={busyReq === r.id} onClick={() => resolveRequest(r, 'reject')}
                  style={{ height: 32, padding: '0 12px', borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.surface, color: color.muted, fontSize: fontSize.sm, fontWeight: fontWeight.medium, cursor: busyReq ? 'default' : 'pointer', opacity: busyReq === r.id ? 0.6 : 1 }}>
                  Reject
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={CARD}>
        <label style={LABEL}>Find a customer</label>
        <Input value={q} onChange={(v) => { setQ(v); setSelected(null); }} placeholder="Search by email or name (partial match)…" />

        {searching && <div data-testid="search-busy" style={{ marginTop: 10, fontSize: fontSize.sm, color: color.subtle }}>Searching…</div>}

        {!searching && results !== null && !selected && (
          results.length ? (
            <ul data-testid="search-results" style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    data-testid="search-result"
                    onClick={() => setSelected(c)}
                    style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: radius.lg, border: `1px solid ${color.surfaceAlt}`, background: color.appBg, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <span style={{ fontSize: 13, color: color.ink, fontWeight: fontWeight.medium }}>{c.email}</span>
                    {c.name && <span style={{ fontSize: fontSize.sm, color: color.muted }}>{c.name}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: color.subtle, fontFamily: font.mono }}>#{c.id.slice(0, 8)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div data-testid="no-results" style={{ marginTop: 12, fontSize: fontSize.base, color: color.muted }}>No customers match “{q.trim()}”.</div>
          )
        )}

        {selected && (
          <div data-testid="grant-panel" style={{ marginTop: 16, padding: '16px 18px', background: color.appBg, border: `1px solid ${color.surfaceAlt}`, borderRadius: radius.lg }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div>
                <div data-testid="selected-email" style={{ fontSize: 13.5, color: color.ink, fontWeight: fontWeight.medium }}>{selected.email}</div>
                {selected.name && <div style={{ fontSize: fontSize.sm, color: color.muted }}>{selected.name}</div>}
              </div>
              <button onClick={() => setSelected(null)} data-testid="clear-selection" style={{ marginLeft: 'auto', fontSize: fontSize.sm, color: color.info, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>change</button>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ width: 120 }}>
                <label style={{ ...LABEL, marginBottom: 6 }}>Credits</label>
                <Input value={amount} onChange={setAmount} type="number" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ ...LABEL, marginBottom: 6 }}>Note (optional)</label>
                <Input value={note} onChange={setNote} placeholder="e.g. onboarding grant" />
              </div>
              <Button onClick={grant} disabled={!amountValid || granting} testId="grant-button">
                {granting ? 'Granting…' : 'Grant credits'}
              </Button>
            </div>
            {!amountValid && <div data-testid="amount-invalid" style={{ marginTop: 8, fontSize: fontSize.sm, color: color.danger }}>Amount must be a positive whole number.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

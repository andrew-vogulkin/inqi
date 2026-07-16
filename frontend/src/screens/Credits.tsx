import { CSSProperties, useEffect, useState } from 'react';
import { AsyncStatus, ToastKind } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { LEDGER_LABEL, ledgerTone, ledgerSign, ledgerIcon, relativeTime } from '../conventions/credits';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { creditsApi, ApiError } from '../api';
import { CreditEntry } from '../api/types';
import { EmptyState, Skeleton } from '../ui';
import { toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

const PAGE: CSSProperties = { maxWidth: 680, margin: '0 auto' };

/** FE-09 — the customer's credit balance + ledger, with a top-up request (no realtime; manual refresh). */
export function Credits() {
  const dispatch = useAppDispatch();
  const credits = useSelector((s) => s.credits);

  function load() {
    dispatch({ type: ActionType.CreditsLoading });
    creditsApi.mine()
      .then((c) => dispatch({ type: ActionType.CreditsLoaded, balance: c.balance, history: c.history }))
      .catch(() => undefined);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [amount, setAmount] = useState('5');
  const [requesting, setRequesting] = useState(false);
  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && amountNum > 0;

  // Files a persisted request an operator approves/rejects (no balance change here).
  async function requestTopUp() {
    if (!amountValid || requesting) return;
    setRequesting(true);
    try {
      await creditsApi.requestTopUp({ amount: amountNum });
      dispatch({ type: ActionType.ToastPushed, toast: { id: `topup-req-${Date.now()}`, kind: ToastKind.Success, message: `Requested ${amountNum} credit${amountNum === 1 ? '' : 's'} — an operator will review it shortly.` } });
    } catch (e) {
      dispatch({ type: ActionType.ToastPushed, toast: { id: `topup-err-${Date.now()}`, kind: ToastKind.Danger, message: e instanceof ApiError ? e.message : 'Could not send the request — try again.' } });
    } finally {
      setRequesting(false);
    }
  }

  const ready = credits.status === AsyncStatus.Ready;
  const loading = credits.status === AsyncStatus.Loading || credits.status === AsyncStatus.Idle;

  return (
    <div style={{ ...PAGE }} data-testid="credits">
      <a href={hrefFor({ route: Route.Dashboard })} style={{ fontSize: fontSize.base, color: color.muted, marginBottom: space[4], display: 'inline-flex', alignItems: 'center', gap: 5 }}>‹ Dashboard</a>
      <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 22px' }}>Credits</h1>

      <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        {/* Balance card (dark) */}
        <div style={{ flex: 1, minWidth: 200, background: color.ink, color: color.onSolid, borderRadius: radius.xl, padding: '22px 24px' }}>
          <div style={{ fontSize: 12.5, color: color.subtle, marginBottom: 10 }}>Current balance</div>
          <div data-testid="balance" style={{ fontSize: 40, fontWeight: fontWeight.semibold, letterSpacing: '-.03em', lineHeight: 1, fontFamily: font.mono }}>
            {ready ? credits.balance : <Skeleton width={64} height={36} />}
          </div>
          <div style={{ fontSize: 12.5, color: color.subtle, marginTop: 8 }}>credits · 1 per delivered report</div>
        </div>

        {/* Top-up request card (light) */}
        <div style={{ flex: 1, minWidth: 200, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xl, padding: '22px 24px' }}>
          <div style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, marginBottom: 7 }}>Need more?</div>
          <p style={{ fontSize: fontSize.base, color: color.muted, lineHeight: 1.5, margin: '0 0 14px' }}>Top-ups are added manually by the inqi team while we're in early access. Request the credits you need and we'll review it.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              data-testid="request-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)}
              aria-label="Credits to request"
              style={{ width: 72, height: 36, padding: '0 10px', borderRadius: radius.md, border: `1px solid ${color.line}`, background: color.appBg, fontSize: fontSize.base, fontFamily: font.mono, color: color.ink }} />
            <button onClick={requestTopUp} disabled={!amountValid || requesting} data-testid="request-topup"
              style={{ height: 36, padding: '0 14px', borderRadius: radius.md, background: color.appBg, border: `1px solid ${color.line}`, fontSize: fontSize.base, fontWeight: fontWeight.medium, color: color.ink, cursor: amountValid && !requesting ? 'pointer' : 'default', opacity: amountValid && !requesting ? 1 : 0.6 }}>
              {requesting ? 'Requesting…' : 'Request a top-up'}
            </button>
          </div>
        </div>
      </div>

      {/* Ledger */}
      <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xl, overflow: 'hidden', marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], padding: '16px 20px 12px', borderBottom: `1px solid ${color.surfaceAlt}` }}>
          <span style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold }}>Ledger</span>
          <span style={{ flex: 1 }} />
          <button onClick={load} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fontSize.sm, color: color.muted, background: 'transparent', border: `1px solid ${color.line}`, borderRadius: radius.pill, padding: '4px 11px', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
            <span style={loading ? { display: 'inline-block', width: 11, height: 11, borderRadius: '50%', border: `2px solid ${color.line}`, borderTopColor: color.subtle, animation: 'inqi-spin .8s linear infinite' } : undefined}>{loading ? '' : '↻'}</span>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {loading && [0, 1, 2].map((i) => (
          <div key={i} style={{ padding: '13px 20px', borderBottom: `1px solid ${color.surfaceSunken}` }}><Skeleton /></div>
        ))}
        {ready && credits.history.length === 0 && (
          <div style={{ padding: space[5] }}><EmptyState title="No credit activity yet" hint="Your top-ups and report charges will show up here." /></div>
        )}
        {ready && credits.history.map((e) => <LedgerRow key={e.id} entry={e} />)}
      </div>

      <div style={{ fontSize: fontSize.xs, color: color.subtle, marginTop: 12 }}>1 credit runs one report. Top-ups are applied by an operator — refresh to see a new balance.</div>
    </div>
  );
}

function LedgerRow({ entry }: { entry: CreditEntry }) {
  const tone = toneColors[ledgerTone(entry.kind)];
  const sign = ledgerSign(entry.kind);
  const amtColor = sign === '+' ? color.brand : sign === '−' ? color.ink : color.subtle;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', borderBottom: `1px solid ${color.surfaceSunken}` }}>
      <div style={{ width: 30, height: 30, borderRadius: radius.md, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.md, background: tone.bg, color: tone.fg }}>{ledgerIcon(entry.kind)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: fontWeight.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span>{LEDGER_LABEL[entry.kind] ?? entry.kind}</span>{entry.reason ? <span style={{ color: color.subtle, fontWeight: fontWeight.regular }}> · {entry.reason}</span> : null}
        </div>
        <div style={{ fontSize: fontSize.xs, color: color.subtle }}>
          {relativeTime({ iso: entry.createdAt, now: Date.now() })}{entry.reportId ? ` · #${entry.reportId.slice(0, 8)}` : ''}
        </div>
      </div>
      <span style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, fontFamily: font.mono, color: amtColor }}>{sign}{entry.amount}</span>
    </div>
  );
}

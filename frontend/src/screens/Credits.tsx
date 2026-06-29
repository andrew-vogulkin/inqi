import { useEffect } from 'react';
import { AsyncStatus, ButtonVariant, ToastKind } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { LEDGER_LABEL, ledgerTone, ledgerSign, relativeTime } from '../conventions/credits';
import { color, space, fontSize, fontWeight, font } from '../theme/tokens';
import { creditsApi } from '../api';
import { CreditEntry } from '../api/types';
import { Card, Button, Badge, MonoRef, EmptyState, Skeleton } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';

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

  // "Request a top-up" is a lightweight ask — toast only, NO balance change (operators apply it, FE-16).
  function requestTopUp() {
    dispatch({ type: ActionType.ToastPushed, toast: { id: `topup-req-${credits.history.length}`, kind: ToastKind.Success, message: 'Top-up requested — an operator will add credits shortly.' } });
  }

  const loading = credits.status === AsyncStatus.Loading || credits.status === AsyncStatus.Idle;

  return (
    <div style={{ display: 'grid', gap: space[4] }} data-testid="credits">
      <Card>
        <div style={{ fontSize: fontSize.sm, color: color.muted }}>Your balance</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: space[2], marginTop: space[1] }}>
          <span data-testid="balance" style={{ fontFamily: font.mono, fontSize: 40, fontWeight: fontWeight.bold, color: credits.balance > 0 ? color.brand : color.ink }}>
            {credits.status === AsyncStatus.Ready ? credits.balance : <Skeleton width={64} height={36} />}
          </span>
          <span style={{ color: color.muted }}>credits</span>
        </div>
        <div style={{ display: 'flex', gap: space[2], marginTop: space[3] }}>
          <Button onClick={requestTopUp}>Request a top-up</Button>
          <Button variant={ButtonVariant.Secondary} onClick={load} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</Button>
          <a href={hrefFor({ route: Route.NewInquiry })}><Button variant={ButtonVariant.Ghost}>New inquiry</Button></a>
        </div>
        <div style={{ fontSize: fontSize.xs, color: color.subtle, marginTop: space[2] }}>1 credit runs one report. Top-ups are applied by an operator — refresh to see a new balance.</div>
      </Card>

      <section>
        <h3 style={{ fontSize: fontSize.h3, marginBottom: space[2] }}>History</h3>
        {loading && <div style={{ display: 'grid', gap: space[2] }}>{[0, 1, 2].map((i) => <Card key={i}><Skeleton /></Card>)}</div>}
        {credits.status === AsyncStatus.Ready && credits.history.length === 0 && (
          <EmptyState title="No credit activity yet" hint="Your top-ups and report charges will show up here." />
        )}
        <div style={{ display: 'grid', gap: space[1] }}>
          {credits.history.map((e) => <LedgerRow key={e.id} entry={e} />)}
        </div>
      </section>
    </div>
  );
}

function LedgerRow({ entry }: { entry: CreditEntry }) {
  const tone = ledgerTone(entry.kind);
  const sign = ledgerSign(entry.kind);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: space[3], alignItems: 'center', padding: `${space[2]}px ${space[3]}px`, border: `1px solid ${color.line}`, borderRadius: 8 }}>
      <Badge tone={tone}>{LEDGER_LABEL[entry.kind] ?? entry.kind}</Badge>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: fontSize.sm, color: color.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.reason ?? '—'}</div>
        <div style={{ fontSize: fontSize.xs, color: color.subtle }}>
          {relativeTime({ iso: entry.createdAt, now: Date.now() })}
          {entry.inquiryId && <> · <MonoRef muted>#{entry.inquiryId.slice(0, 8)}</MonoRef></>}
        </div>
      </div>
      <span style={{ fontFamily: font.mono, fontWeight: fontWeight.semibold, color: sign === '+' ? color.brand : sign === '−' ? color.ink : color.subtle }}>{sign}{entry.amount}</span>
    </div>
  );
}

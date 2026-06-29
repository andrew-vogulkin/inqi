import { useEffect } from 'react';
import { AsyncStatus, FreemiumState, ToastKind, StatusTone } from '../conventions/enums';
import { Route, navigate } from '../conventions/routes';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { inquiriesApi, reportsApi, creditsApi, ApiError, ApiErrorCode } from '../api';
import { Card, Button, Badge, EmptyState, ErrorState, Skeleton } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';
import { freemiumView } from '../state/report.reducer';
import { OptionCard } from './LiveReport';

/** FE-07 — the conversion surface: #5 revealed, top-4 locked, unlock with 1 credit. */
export function FreemiumTeaser({ inquiryId }: { inquiryId: string }) {
  const dispatch = useAppDispatch();
  const report = useSelector((s) => s.report);
  const balance = useSelector((s) => s.credits.balance);
  const creditsStatus = useSelector((s) => s.credits.status);

  useEffect(() => { dispatch({ type: ActionType.ReportCleared }); }, [inquiryId, dispatch]);
  useRealtime({ kind: 'inquiry', inquiryId });

  // Snapshot-then-stream (the redacted snapshot withholds the hidden options).
  useEffect(() => {
    inquiriesApi.reportLive({ id: inquiryId }).then((live) => dispatch({ type: ActionType.ReportSnapshotReceived, live })).catch(() => undefined);
    creditsApi.mine().then((c) => dispatch({ type: ActionType.CreditsLoaded, balance: c.balance, history: c.history })).catch(() => undefined);
  }, [inquiryId, report.cursor, dispatch]);

  async function unlock() {
    if (balance <= 0) {
      dispatch({ type: ActionType.ToastPushed, toast: { id: `nc-${report.cursor}`, kind: ToastKind.Warn, message: 'Not enough credits — top up to unlock.' } });
      navigate({ route: Route.Credits });
      return;
    }
    if (!report.reportId) {
      dispatch({ type: ActionType.UnlockFailed, message: 'Report is still being prepared — try again in a moment.' });
      return;
    }
    dispatch({ type: ActionType.UnlockStarted });
    try {
      await reportsApi.unlock({ reportId: report.reportId }); // HP-21: charges 1 credit (402 if none)
      const live = await inquiriesApi.reportLive({ id: inquiryId }); // re-read → unlocked:true reveals all
      dispatch({ type: ActionType.ReportSnapshotReceived, live });
      const c = await creditsApi.mine();
      dispatch({ type: ActionType.CreditsLoaded, balance: c.balance, history: c.history });
      dispatch({ type: ActionType.ToastPushed, toast: { id: `unlocked-${inquiryId}`, kind: ToastKind.Success, message: 'Unlocked — full report revealed.' } });
    } catch (e) {
      const msg = e instanceof ApiError && e.code === ApiErrorCode.CreditsInsufficient ? 'Not enough credits — top up to unlock.' : 'Could not unlock. Please try again.';
      dispatch({ type: ActionType.UnlockFailed, message: msg });
    }
  }

  if (report.status !== AsyncStatus.Ready) return <Card><div style={{ display: 'grid', gap: space[2] }}><Skeleton width="40%" /><Skeleton /></div></Card>;

  const { locked, revealed } = freemiumView(report);
  const unlocked = report.freemiumState === FreemiumState.Unlocked;

  // Once unlocked (or never freemium) → the full FE-06 ranked list.
  if (unlocked) {
    const all = report.order.map((id) => report.optionsById[id]);
    return (
      <div style={{ display: 'grid', gap: space[3] }}>
        <h1 style={{ fontSize: fontSize.h2 }}>Your full report</h1>
        <p style={{ color: color.muted, marginTop: -space[2] }}>{report.rawRequest}</p>
        {all.map((o, i) => <OptionCard key={o.subjectProvider || o.id} option={o} rank={i} best={i === 0} />)}
      </div>
    );
  }

  if (revealed.length === 0 && locked.length === 0) {
    return <EmptyState title="No options yet" hint="inqi is still researching — check back shortly." />;
  }

  return (
    <div style={{ display: 'grid', gap: space[4] }} data-testid="freemium-teaser">
      <header>
        <h1 style={{ fontSize: fontSize.h2 }}>Your free report</h1>
        <p style={{ color: color.muted }}>{report.rawRequest}</p>
      </header>

      <Card sunken>
        <b style={{ color: color.brandStrong }}>+{locked.length} better option{locked.length === 1 ? '' : 's'}</b> found and ranked above your free taster. Unlock to see them all.
      </Card>

      {/* Locked stack — the FE holds NO data for these (redacted DTO): just rank + a silhouette. */}
      <div style={{ display: 'grid', gap: space[2] }} data-testid="locked-stack">
        {locked.map((o) => <LockedRow key={o.id} rank={o.rank} />)}
      </div>

      <div style={{ textAlign: 'center' }}>
        <Button onClick={unlock} disabled={report.freemiumState === FreemiumState.Unlocking}>
          {report.freemiumState === FreemiumState.Unlocking ? 'Unlocking…' : 'Unlock full report · 1 credit'}
        </Button>
        <div style={{ fontSize: fontSize.xs, color: creditsStatus === AsyncStatus.Ready && balance <= 0 ? color.warn : color.subtle, marginTop: space[1] }}>
          {creditsStatus === AsyncStatus.Ready ? `${balance} credit${balance === 1 ? '' : 's'} available` : ' '}
        </div>
        {report.error && <p style={{ color: color.danger, fontSize: fontSize.sm }}>{report.error}</p>}
      </div>

      {/* The free taster — fully rendered (reuses the FE-06 option card). */}
      <section>
        <h3 style={{ fontSize: fontSize.h3, marginBottom: space[2] }}>Your free option</h3>
        {revealed.map((o) => <OptionCard key={o.subjectProvider || o.id} option={o} rank={(o.rank ?? 1) - 1} best={false} />)}
      </section>
    </div>
  );
}

/** A redacted locked row — conveys "a better option" without leaking any data. */
function LockedRow({ rank }: { rank?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: space[3], border: `1px dashed ${color.lineStrong}`, borderRadius: radius.lg, background: color.surfaceSunken }}>
      <span style={{ color: color.subtle, fontWeight: fontWeight.semibold }}>#{rank ?? '—'}</span>
      <div style={{ flex: 1, display: 'grid', gap: 6 }}>
        <div style={{ height: 10, width: '45%', background: color.lineStrong, borderRadius: radius.pill }} />
        <div style={{ height: 8, width: '70%', background: color.line, borderRadius: radius.pill }} />
      </div>
      <Badge tone={StatusTone.Muted}>🔒 Locked</Badge>
    </div>
  );
}

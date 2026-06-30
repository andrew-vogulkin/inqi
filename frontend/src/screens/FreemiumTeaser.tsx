import { CSSProperties, useEffect } from 'react';
import { AsyncStatus, FreemiumState, ToastKind } from '../conventions/enums';
import { Route, navigate, hrefFor } from '../conventions/routes';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { inquiriesApi, reportsApi, creditsApi, ApiError, ApiErrorCode } from '../api';
import { EmptyState, Skeleton } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';
import { freemiumView } from '../state/report.reducer';
import { optionId, RankedOption } from '../conventions/ranking';
import { OptionCard } from './LiveReport';

const PAGE: CSSProperties = { maxWidth: 660, margin: '0 auto' };

/** FE-07 — the conversion surface: free taster revealed, better options locked, unlock with 1 credit. */
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

  if (report.status !== AsyncStatus.Ready) {
    return <div style={{ ...PAGE }}><Skeleton width="40%" /><div style={{ height: 12 }} /><Skeleton /><div style={{ height: 8 }} /><Skeleton width="70%" /></div>;
  }

  const { locked, revealed } = freemiumView(report);
  const unlocked = report.freemiumState === FreemiumState.Unlocked;
  const total = locked.length + revealed.length;
  const ref = `#${(report.inquiryId ?? '').slice(0, 8)}`;
  // Revealed (qualified) options link to their research dossier; locked rows stay redacted.
  const dossierFor = (o: RankedOption) => report.inquiryId ? hrefFor({ route: Route.Dossier, params: { id: report.inquiryId, ref: optionId(o) } }) : undefined;

  // Once unlocked (or never freemium) → the full FE-06 ranked list + the success banner.
  if (unlocked) {
    const all = report.order.map((id) => report.optionsById[id]);
    return (
      <div style={{ ...PAGE }}>
        <a href={hrefFor({ route: Route.Dashboard })} style={{ fontSize: fontSize.base, color: color.muted, marginBottom: space[4], display: 'inline-flex', alignItems: 'center', gap: 5 }}>‹ Dashboard</a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: color.brandTint, border: `1px solid #cdeede`, borderRadius: radius.lg, padding: '11px 15px', marginBottom: space[4], fontSize: fontSize.base, color: color.brandStrong }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', flex: 'none', background: color.brand, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>✓</span>
          Full report unlocked · all {all.length} options ranked
        </div>
        <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 5px' }}>Your full report</h1>
        <p style={{ color: color.muted, margin: `0 0 ${space[4]}px` }}>{report.rawRequest}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {all.map((o, i) => <OptionCard key={o.subjectProvider || o.id} option={o} rank={i} best={i === 0} dossierHref={dossierFor(o)} />)}
        </div>
      </div>
    );
  }

  if (revealed.length === 0 && locked.length === 0) {
    return <div style={{ ...PAGE }}><EmptyState title="No options yet" hint="inqi is still researching — check back shortly." /></div>;
  }

  const revealRank = revealed[0]?.rank ?? total;
  const unlocking = report.freemiumState === FreemiumState.Unlocking;
  const noCredits = creditsStatus === AsyncStatus.Ready && balance <= 0;

  return (
    <div style={{ ...PAGE }} data-testid="freemium-teaser">
      <a href={hrefFor({ route: Route.Dashboard })} style={{ fontSize: fontSize.base, color: color.muted, marginBottom: space[4], display: 'inline-flex', alignItems: 'center', gap: 5 }}>‹ Dashboard</a>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[4], marginBottom: 6 }}>
        <h1 style={{ fontSize: 23, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: 0 }}>{report.rawRequest}</h1>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: radius.pill, fontSize: fontSize.base, fontWeight: fontWeight.medium, flex: 'none', background: color.infoTint, color: color.info }}>Report ready</span>
      </div>
      <div style={{ fontSize: 12.5, color: color.subtle, marginBottom: 22, fontFamily: font.mono }}>{ref} · free first report</div>

      {/* Summary card */}
      <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.xl, padding: '22px 24px', marginBottom: 14, display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: fontWeight.semibold, marginBottom: 5 }}>We ranked your top {total} option{total === 1 ? '' : 's'}.</div>
          <div style={{ fontSize: 13.5, color: color.muted, lineHeight: 1.5 }}>Your free report reveals option #{revealRank}. The {locked.length} better-ranked option{locked.length === 1 ? '' : 's'} {locked.length === 1 ? 'is' : 'are'} unlocked with 1 credit.</div>
        </div>
        <div style={{ textAlign: 'center', flex: 'none' }}>
          <div style={{ fontSize: 34, fontWeight: fontWeight.semibold, fontFamily: font.mono, letterSpacing: '-.03em', lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: fontSize.xs, color: color.subtle }}>ranked</div>
        </div>
      </div>

      {/* Locked stack — the FE holds NO data for these (redacted DTO): just a rank + a silhouette. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }} data-testid="locked-stack">
        {locked.map((o) => <LockedRow key={o.id} rank={o.rank} />)}
      </div>

      {/* Unlock CTA overlay */}
      <div style={{ margin: '14px 0', background: color.ink, borderRadius: radius.xl, padding: '22px 24px', textAlign: 'center', color: color.onSolid }}>
        <div style={{ fontSize: 17, fontWeight: fontWeight.semibold, marginBottom: 6 }}>+{locked.length} better option{locked.length === 1 ? '' : 's'} above</div>
        <div style={{ fontSize: 13.5, color: '#b5b4ae', lineHeight: 1.5, maxWidth: 380, margin: '0 auto 18px' }}>Stronger public feedback, better availability, and stronger value than the option below. Provider details stay hidden until you unlock.</div>
        <button onClick={unlock} disabled={unlocking}
          style={{ height: 44, padding: '0 24px', borderRadius: radius.md, background: color.brand, color: color.onSolid, border: 'none', fontSize: fontSize.lg, fontWeight: fontWeight.semibold, display: 'inline-flex', alignItems: 'center', gap: 9, cursor: unlocking ? 'default' : 'pointer', opacity: unlocking ? 0.7 : 1 }}>
          {unlocking ? 'Unlocking…' : <>Unlock full report <span style={{ background: 'rgba(255,255,255,.2)', padding: '2px 8px', borderRadius: radius.sm, fontSize: 12.5, fontWeight: fontWeight.medium }}>1 credit</span></>}
        </button>
        <div style={{ fontSize: fontSize.xs, color: noCredits ? color.warn : '#7a7a74', marginTop: 12 }}>
          {creditsStatus === AsyncStatus.Ready ? `You have ${balance} credit${balance === 1 ? '' : 's'}` : ' '}
        </div>
        {report.error && <div style={{ color: '#f0b6b1', fontSize: fontSize.sm, marginTop: 8 }}>{report.error}</div>}
      </div>

      {/* The free taster — fully rendered (reuses the FE-06 option card). */}
      <div style={{ fontSize: 11.5, color: color.subtle, fontWeight: fontWeight.semibold, letterSpacing: '.04em', textTransform: 'uppercase', margin: '6px 2px 9px' }}>Revealed in your free report</div>
      {revealed.map((o) => <OptionCard key={o.subjectProvider || o.id} option={o} rank={(o.rank ?? 1) - 1} best={false} dossierHref={dossierFor(o)} />)}
    </div>
  );
}

/** A redacted locked row — conveys "a better option" without leaking any data. */
function LockedRow({ rank }: { rank?: number }) {
  return (
    <div style={{ background: color.surface, border: `1px solid #ececea`, borderRadius: radius.lg, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, filter: 'blur(.4px)', opacity: 0.92 }}>
      <div style={{ width: 26, height: 26, borderRadius: radius.sm, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.base, fontWeight: fontWeight.semibold, fontFamily: font.mono, background: color.surfaceSunken, color: '#c9c8c2' }}>{rank ?? '—'}</div>
      <div style={{ flex: 1 }}>
        <div style={{ height: 13, width: '46%', borderRadius: radius.sm, background: '#edece8', marginBottom: 8 }} />
        <div style={{ height: 9, width: '64%', borderRadius: 5, background: color.surfaceSunken }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#c9c8c2', fontSize: 12.5 }}><span style={{ fontSize: 14 }}>🔒</span> locked</div>
    </div>
  );
}

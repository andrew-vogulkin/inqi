import { useEffect } from 'react';
import { AsyncStatus } from '../conventions/enums';
import { Route, navigate, hrefFor } from '../conventions/routes';
import { Stage, stageForReport, stageIndex, isFailedState, isLiveStage, stageBadge, routeForStage, STAGE_ORDER } from '../conventions/stages';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { reportsApi, creditsApi } from '../api';
import { ReportDto } from '../api/types';
import { MonoRef, Skeleton } from '../ui';
import { toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtimeReports } from '../realtime/socket';

/** FE-03 — authenticated home: own reports (6-stage pipeline) + credit balance (prototype-matched). */
export function Dashboard() {
  const dispatch = useAppDispatch();
  const reports = useSelector((s) => s.reports);
  const credits = useSelector((s) => s.credits);
  const order = reports.order;
  // Drafts (unsubmitted / RECEIVED) are hidden from the dashboard — they're not in flight.
  const visible = order.filter((id) => {
    const i = reports.byId[id];
    return i && stageForReport({ state: i.state, stage: i.stage, qualifiedCount: i.qualifiedCount }) !== Stage.Draft;
  });

  useEffect(() => {
    reportsApi.list().then((rows) => dispatch({ type: ActionType.ReportsLoaded, reports: rows })).catch(() => undefined);
    creditsApi.mine().then((c) => dispatch({ type: ActionType.CreditsLoaded, balance: c.balance, history: c.history })).catch(() => undefined);
  }, [dispatch]);

  useRealtimeReports({ reportIds: order });

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[4], marginBottom: space[6] }}>
        <div>
          <h1 style={{ fontSize: fontSize.h1, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: `0 0 ${space[1]}px` }}>Your reports</h1>
          <p style={{ fontSize: fontSize.md, color: color.muted, margin: 0 }}>Everything you&apos;ve asked inqi to find.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          <a href={hrefFor({ route: Route.Credits })} data-testid="credits-chip"
            style={{ height: 36, padding: `0 ${space[3]}px`, borderRadius: radius.md, background: color.surface, border: `1px solid ${color.line}`, display: 'flex', alignItems: 'center', gap: 7, fontSize: fontSize.base, fontWeight: fontWeight.medium, color: color.ink, textDecoration: 'none' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color.brand }} />
            {credits.status === AsyncStatus.Ready ? `${credits.balance} credits` : <Skeleton width={48} />}
          </a>
          <a href={hrefFor({ route: Route.NewReport })}
            style={{ height: 36, padding: `0 ${space[4]}px`, borderRadius: radius.md, background: color.ink, color: color.onSolid, display: 'flex', alignItems: 'center', fontSize: fontSize.base, fontWeight: fontWeight.medium, textDecoration: 'none' }}>
            New report
          </a>
        </div>
      </header>

      {reports.status === AsyncStatus.Idle && <Skeletons />}
      {reports.status === AsyncStatus.Ready && visible.length === 0 && <EmptyDash />}

      {visible.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
          {visible.map((id) => <ReportRow key={id} report={reports.byId[id]} />)}
        </div>
      )}
    </div>
  );
}

function ReportRow({ report }: { report: ReportDto }) {
  const stage = stageForReport({ state: report.state, stage: report.stage, qualifiedCount: report.qualifiedCount });
  const idx = stageIndex(stage);
  const failed = isFailedState(report.state);
  const badge = stageBadge({ stage, state: report.state });
  const live = isLiveStage(stage) && !failed;
  const fg = toneColors[badge.tone].fg;
  const go = () => { const m = routeForStage({ stage, reportId: report.id }); navigate({ route: m.route, params: m.params }); };

  return (
    <button onClick={go} data-testid="report-row"
      style={{ textAlign: 'left', background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[4], display: 'flex', alignItems: 'center', gap: space[4], cursor: 'pointer' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: 9 }}>
          <span style={{ fontSize: fontSize.lg, fontWeight: fontWeight.medium, letterSpacing: '-.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{report.rawRequest.slice(0, 80)}</span>
          <MonoRef muted>#{report.id.slice(0, 8)}</MonoRef>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {STAGE_ORDER.map((s: Stage, i: number) => {
              const fill = failed && i === idx ? color.danger : i <= idx ? color.brand : color.line;
              return <span key={s} title={s} style={{ width: 24, height: 4, borderRadius: 2, background: fill }} />;
            })}
          </div>
          <span data-testid="report-status" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: fg }}>
            {live && <span style={{ width: 6, height: 6, borderRadius: '50%', background: fg, animation: 'inqi-pulse 1.4s ease-in-out infinite' }} />}
            {badge.label}
          </span>
          <span style={{ fontSize: fontSize.xs, color: color.lineStrong }}>·</span>
          <span style={{ fontSize: fontSize.xs, color: color.subtle }}>started {new Date(report.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
      <span style={{ color: color.lineStrong, fontSize: fontSize.h3 }}>›</span>
    </button>
  );
}

function EmptyDash() {
  return (
    <div style={{ border: `1px dashed ${color.lineStrong}`, borderRadius: radius.lg, padding: `56px ${space[8]}px`, textAlign: 'center', background: color.surface }}>
      <div style={{ width: 42, height: 42, borderRadius: radius.md, background: color.surfaceSunken, color: color.subtle, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: `0 auto ${space[4]}px`, fontSize: fontSize.h2 }}>⌕</div>
      <h3 style={{ fontSize: fontSize.h3, fontWeight: fontWeight.semibold, margin: '0 0 7px' }}>Nothing in flight yet</h3>
      <p style={{ fontSize: fontSize.md, color: color.muted, margin: `0 auto ${space[5]}px`, maxWidth: 340, lineHeight: 1.55 }}>Describe something you need — an item, a service, a rental — and inqi&apos;s agents get to work.</p>
      <a href={hrefFor({ route: Route.NewReport })} style={{ display: 'inline-flex', height: 40, padding: `0 ${space[5]}px`, alignItems: 'center', borderRadius: radius.md, background: color.ink, color: color.onSolid, fontSize: fontSize.md, fontWeight: fontWeight.medium, textDecoration: 'none' }}>Start your first report</a>
    </div>
  );
}

function Skeletons() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: space[4], display: 'grid', gap: space[2] }}>
          <Skeleton width="50%" /><Skeleton width="40%" />
        </div>
      ))}
    </div>
  );
}

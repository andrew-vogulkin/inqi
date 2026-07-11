import { ReactNode, useEffect, useState } from 'react';
import { AsyncStatus } from '../conventions/enums';
import { color, fontSize, fontWeight, radius } from '../theme/tokens';
import { reportsApi } from '../api';
import { ReportDto } from '../api/types';
import { Skeleton, EmptyState } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';
import { AdminBoardState } from '../state/adminBoard.reducer';
import { ReportPicker } from './ReportPicker';

/** Read `?id=` from the current hash (the frame's report selection). */
function selectedIdFromHash(): string | null {
  const q = window.location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get('id') : null;
}

/**
 * Top-level admin screens that are inherently per-report (Run controls, Cost per
 * report) reach this frame from the sidebar with no id. The report picker resolves
 * the selection (`?id=`, else the most recent report), loads its board into state,
 * and renders the child with the resolved report + board. The picker popup searches
 * by ref / customer / request text and scrolls through older pages.
 */
export function AdminReportFrame({ title, basePath, children }: { title: string; basePath: string; children: (ctx: { reportId: string; board: AdminBoardState }) => ReactNode }) {
  const dispatch = useAppDispatch();
  const board = useSelector((s) => s.adminBoard);
  const [picked, setPicked] = useState<string | null>(selectedIdFromHash());
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [noReports, setNoReports] = useState(false);
  const activeId = picked ?? defaultId;

  useEffect(() => { if (activeId) reportsApi.detail({ id: activeId }).then((b) => dispatch({ type: ActionType.AdminBoardLoaded, board: b })).catch(() => undefined); }, [activeId, dispatch]);
  useRealtime({ kind: 'admin' });

  function pick(report: ReportDto) {
    setPicked(report.id);
    window.location.hash = `${basePath}?id=${report.id}`;
  }

  const ready = board.status === AsyncStatus.Ready && board.reportId === activeId;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 4px' }}>{title}</h1>
          <p style={{ fontSize: fontSize.base, color: color.muted, margin: 0 }}>Select a report to inspect.</p>
        </div>
        <ReportPicker
          activeId={activeId}
          onPick={pick}
          onDefault={(r) => { if (r) setDefaultId(r.id); else setNoReports(true); }}
        />
      </div>

      {noReports && !activeId
        ? <EmptyState title="No reports yet" hint="Reports appear here as customers submit them." />
        : ready
          ? children({ reportId: activeId as string, board })
          : <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '16px 18px' }}><Skeleton width="40%" /><div style={{ height: 10 }} /><Skeleton /></div>}
    </div>
  );
}

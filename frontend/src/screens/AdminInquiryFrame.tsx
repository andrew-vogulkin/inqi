import { ReactNode, useEffect, useState } from 'react';
import { AsyncStatus } from '../conventions/enums';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { inquiriesApi } from '../api';
import { InquiryDto } from '../api/types';
import { Skeleton, EmptyState } from '../ui';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';
import { AdminBoardState } from '../state/adminBoard.reducer';

/** Read `?id=` from the current hash (the frame's inquiry selection). */
function selectedIdFromHash(): string | null {
  const q = window.location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get('id') : null;
}

/**
 * Top-level admin screens that are inherently per-inquiry (Run controls, Cost per
 * report) reach this frame from the sidebar with no id. It lists the inquiries,
 * auto-selects the most recent (or `?id=`), loads its board into state, and renders
 * the child with the resolved inquiry + board. A pill switcher changes the selection.
 */
export function AdminInquiryFrame({ title, basePath, children }: { title: string; basePath: string; children: (ctx: { inquiryId: string; board: AdminBoardState }) => ReactNode }) {
  const dispatch = useAppDispatch();
  const board = useSelector((s) => s.adminBoard);
  const [tabs, setTabs] = useState<InquiryDto[]>([]);
  const [picked, setPicked] = useState<string | null>(selectedIdFromHash());
  const activeId = picked ?? tabs[0]?.id ?? null;

  useEffect(() => { inquiriesApi.list().then((rows) => setTabs(Array.isArray(rows) ? rows : [])).catch(() => undefined); }, []);
  useEffect(() => { if (activeId) inquiriesApi.detail({ id: activeId }).then((b) => dispatch({ type: ActionType.AdminBoardLoaded, board: b })).catch(() => undefined); }, [activeId, dispatch]);
  useRealtime({ kind: 'admin' });

  function pick(id: string) {
    setPicked(id);
    window.location.hash = `${basePath}?id=${id}`;
  }

  const ready = board.status === AsyncStatus.Ready && board.inquiryId === activeId;

  return (
    <div>
      <h1 style={{ fontSize: 21, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: '0 0 4px' }}>{title}</h1>
      <p style={{ fontSize: fontSize.base, color: color.muted, margin: '0 0 16px' }}>Select an inquiry to inspect.</p>

      {tabs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {tabs.map((t) => {
            const on = t.id === activeId;
            return (
              <button key={t.id} onClick={() => pick(t.id)}
                style={{ fontSize: 12.5, padding: '7px 12px', borderRadius: radius.md, border: `1px solid ${on ? color.brand : color.lineStrong}`, background: on ? color.brandTint : color.surface, color: on ? color.brandStrong : color.inkSoft, fontWeight: fontWeight.medium, cursor: 'pointer' }}>
                {t.rawRequest.slice(0, 34)}
              </button>
            );
          })}
        </div>
      )}

      {!activeId && tabs.length === 0
        ? <EmptyState title="No inquiries yet" hint="Inquiries appear here as customers submit them." />
        : ready
          ? children({ inquiryId: activeId as string, board })
          : <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '16px 18px' }}><Skeleton width="40%" /><div style={{ height: 10 }} /><Skeleton /></div>}
    </div>
  );
}

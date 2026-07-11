import { useEffect, useState } from 'react';
import { EventType, InquiryStatus, SourceType } from '@inqi/shared';
import { AsyncStatus, StatusTone } from '../conventions/enums';
import { Route, navigate, hrefFor } from '../conventions/routes';
import { color, space, fontSize, fontWeight, radius, font } from '../theme/tokens';
import { reportsApi } from '../api';
import { Skeleton } from '../ui';
import { toneForReportState, toneForInquiryStatus, toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';
import { AdminBoardState, EpicVM, epicInquiries, epicProgress } from '../state/adminBoard.reducer';
import { RunControlsPanel } from './RunControls';
import { ReportPicker } from './ReportPicker';

const EPIC_PALETTE = [color.brand, color.info, color.inkSoft, color.warn];
const epicColor = (i: number) => EPIC_PALETTE[i % EPIC_PALETTE.length];

/** FE-10 — operator live board for one report: epics → inquiries → findings + activity stream. */
export function AdminBoard({ reportId }: { reportId?: string }) {
  const dispatch = useAppDispatch();
  const board = useSelector((s) => s.adminBoard);
  // No id in the URL → the picker resolves the default (the most recent report).
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const activeId = reportId ?? defaultId;

  // Board detail for the active report.
  useEffect(() => { if (activeId) reportsApi.detail({ id: activeId }).then((b) => dispatch({ type: ActionType.AdminBoardLoaded, board: b })).catch(() => undefined); }, [activeId, dispatch]);

  // Admin room → reducer (the reducer scopes events to the active report).
  useRealtime({ kind: 'admin' });

  const ready = board.status === AsyncStatus.Ready && board.reportId === activeId;

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 21, fontWeight: fontWeight.semibold, letterSpacing: '-.02em', margin: 0 }}>Live board</h1>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fontSize.sm, color: color.brand, background: color.brandTint, padding: '4px 10px', borderRadius: radius.pill }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: color.brand, animation: 'inqi-pulse 1.3s ease-in-out infinite' }} />Live
            </span>
          </div>
          <p style={{ fontSize: fontSize.base, color: color.muted, margin: '5px 0 0' }}>Reports → epics → inquiries → findings, updating in real time.</p>
        </div>
        <ReportPicker
          activeId={activeId}
          onPick={(r) => navigate({ route: Route.AdminReport, params: { id: r.id } })}
          onDefault={(r) => { if (r) setDefaultId(r.id); }}
        />
      </header>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {ready ? <Board board={board} /> : <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '14px 16px' }}><Skeleton width="50%" /></div>}
        </div>
        <ActivityStream board={board} />
      </div>
    </div>
  );
}

function Board({ board }: { board: AdminBoardState }) {
  const [openEpic, setOpenEpic] = useState<string | null>(null);
  const subCount = Object.keys(board.inquiriesById).length;
  return (
    <div>
      {/* Report summary bar */}
      <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ fontSize: fontSize.base, fontWeight: fontWeight.semibold }}>{board.reportId ? `#${board.reportId.slice(0, 8)} · ` : ''}{board.title}</div>
        <div style={{ fontSize: fontSize.sm, color: color.subtle }}>{board.epicOrder.length} epics · {subCount} inquiries</div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: toneColors[toneForReportState(board.reportState)].fg, background: toneColors[toneForReportState(board.reportState)].bg, padding: '4px 10px', borderRadius: radius.pill }}>{board.reportState}</span>
          {board.reportId && <a href={hrefFor({ route: Route.AdminCost, params: { id: board.reportId } })} style={{ fontSize: fontSize.sm, color: color.info }} data-testid="cost-link">cost →</a>}
        </div>
      </div>

      <RunControlsPanel board={board} />

      {board.epicOrder.length === 0 && (
        <div style={{ background: color.surface, border: `1px dashed ${color.lineStrong}`, borderRadius: radius.lg, padding: space[6], textAlign: 'center', color: color.subtle, fontSize: fontSize.sm, marginTop: 14 }}>Epics + inquiries appear here as the agent works.</div>
      )}

      <div style={{ marginTop: 14 }}>
        {openEpic && board.epicsById[openEpic]
          ? <EpicDetail board={board} epic={board.epicsById[openEpic]} index={board.epicOrder.indexOf(openEpic)} onClose={() => setOpenEpic(null)} />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {board.epicOrder.map((id, i) => <EpicCard key={id} board={board} epic={board.epicsById[id]} index={i} onOpen={() => setOpenEpic(id)} />)}
            </div>
          )}
      </div>
    </div>
  );
}

function PersonaTile({ index, strategy, size = 22 }: { index: number; strategy: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: radius.sm, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size > 22 ? fontSize.sm : fontSize.xs, fontWeight: fontWeight.semibold, color: color.onSolid, background: epicColor(index) }}>{(strategy[0] ?? 'E').toUpperCase()}</span>;
}

function EpicCard({ board, epic, index, onOpen }: { board: AdminBoardState; epic: EpicVM; index: number; onOpen: () => void }) {
  const subs = epicInquiries(board, epic.id);
  const failed = subs.filter((s) => s.status === InquiryStatus.Failed).length;
  const { qualified, target } = epicProgress(board, epic.id);
  return (
    <button data-testid="epic-card" onClick={onOpen}
      style={{ textAlign: 'left', background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '15px 17px', cursor: 'pointer', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <PersonaTile index={index} strategy={epic.strategy} />
        <span style={{ fontSize: 14.5, fontWeight: fontWeight.semibold, flex: 1, minWidth: 0 }}>{epic.strategy} epic</span>
        {failed > 0 && <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: color.danger, background: color.dangerTint, padding: '3px 9px', borderRadius: radius.sm }}>{failed} need attention</span>}
        <span style={{ color: '#c9c8c2', fontSize: 18 }}>›</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 11 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {subs.length === 0
            ? <span style={{ fontSize: fontSize.xs, color: color.subtle }}>no inquiries yet</span>
            : subs.map((s) => <span key={s.id} style={{ width: 18, height: 5, borderRadius: 3, background: toneColors[toneForInquiryStatus(s.status)].fg }} />)}
        </div>
        <span style={{ fontSize: fontSize.sm, color: color.brand, fontWeight: fontWeight.medium }}>{qualified}/{target} qualified</span>
        <span style={{ fontSize: fontSize.xs, color: color.subtle }}>· {epic.strategy}</span>
      </div>
    </button>
  );
}

function LineageStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, background: color.ink, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.xs, fontWeight: fontWeight.semibold, fontFamily: font.mono }}>{n}</span>
        <span style={{ fontSize: fontSize.base, fontWeight: fontWeight.semibold }}>{title}</span>
      </div>
      <div style={{ paddingLeft: 31 }}>{children}</div>
    </div>
  );
}

function EpicDetail({ board, epic, index, onClose }: { board: AdminBoardState; epic: EpicVM; index: number; onClose: () => void }) {
  const subs = epicInquiries(board, epic.id);
  return (
    <div>
      <button onClick={onClose} style={{ fontSize: fontSize.base, color: color.muted, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer' }}>‹ All epics</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '15px 17px', marginBottom: 12 }}>
        <PersonaTile index={index} strategy={epic.strategy} size={26} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold }}>{epic.strategy} epic</div>
          <div style={{ fontSize: fontSize.sm, color: color.subtle, marginTop: 2 }}>{epic.strategy} · {board.reportId ? `#${board.reportId.slice(0, 8)}` : ''}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        <LineageStep n={1} title="User request">
          <div style={{ fontSize: 13.5, color: color.inkSoft, lineHeight: 1.5 }}>"{board.lineage.userRequest}"</div>
        </LineageStep>
        <LineageStep n={2} title="Initial research">
          <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.45, display: 'flex', gap: 8 }}><span style={{ color: color.brand }}>✓</span>{board.lineage.initialResearch}</div>
        </LineageStep>
        <LineageStep n={3} title="Confirmed scope · questionnaire">
          <span style={{ fontSize: fontSize.sm, color: color.inkSoft, background: color.surfaceSunken, padding: '4px 10px', borderRadius: 7 }}>{board.lineage.confirmedScope}</span>
          {board.scope && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {board.scope.questions.map((q) => {
                const a = board.scope!.answers[q.id];
                const deferred = !a || a === 'Decide for me';
                return (
                  <div key={q.id} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                    <div style={{ color: color.subtle }}>{q.prompt}</div>
                    <div style={{ color: deferred ? color.muted : color.inkSoft, fontStyle: deferred ? 'italic' : 'normal', marginTop: 1 }}>{a || '—'}</div>
                  </div>
                );
              })}
            </div>
          )}
        </LineageStep>
      </div>

      <div style={{ background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 17px', borderBottom: `1px solid ${color.surfaceAlt}` }}>
          <span style={{ width: 22, height: 22, borderRadius: 7, background: color.ink, color: color.onSolid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.xs, fontWeight: fontWeight.semibold, fontFamily: font.mono }}>4</span>
          <span style={{ fontSize: fontSize.base, fontWeight: fontWeight.semibold }}>Inquiries</span>
          <span style={{ fontSize: fontSize.sm, color: color.subtle, fontFamily: font.mono }}>{subs.length}</span>
        </div>
        {subs.length === 0 && <div style={{ padding: '14px 17px', fontSize: fontSize.sm, color: color.subtle }}>No inquiries yet.</div>}
        {subs.map((s) => {
          const tone = toneColors[toneForInquiryStatus(s.status)];
          const finding = s.status === InquiryStatus.Qualified && typeof s.qualityScore === 'number' ? `Qualified · feedback ${Math.round(s.qualityScore * 100)}` : null;
          return (
            <a key={s.id} href={hrefFor({ route: Route.AdminInquiry, params: { id: s.id } })} data-testid="inquiry-row"
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 17px', borderBottom: `1px solid ${color.surfaceSunken}`, textDecoration: 'none', color: 'inherit' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: tone.fg }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: fontWeight.medium }}>{s.provider} <span style={{ color: color.subtle, fontFamily: font.mono, fontWeight: fontWeight.regular }}>· w{s.wave}</span></div>
                {finding && <div style={{ fontSize: 11.5, color: color.brand, marginTop: 2 }}>{finding}</div>}
              </div>
              {s.researchPending && (
                <span data-testid="research-pending-chip" title="Depth research still queued/running" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: fontSize.xs, fontWeight: fontWeight.medium, padding: '3px 9px', borderRadius: radius.sm, flex: 'none', background: color.infoTint, color: color.info }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', border: `2px solid ${color.info}`, borderTopColor: 'transparent', animation: 'inqi-spin .9s linear infinite' }} />
                  researching
                </span>
              )}
              <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.semibold, padding: '3px 9px', borderRadius: radius.sm, flex: 'none', background: tone.bg, color: tone.fg }}>{s.status}</span>
              <span style={{ color: '#c9c8c2', fontSize: 16, flex: 'none' }}>›</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

const STREAM_LABEL: Record<string, (d: Record<string, unknown>) => string> = {
  [EventType.EpicCreated]: (d) => `epic created (${d.strategy})`,
  [EventType.InquiryCreated]: (d) => `inquiry: ${d.name}`,
  [EventType.SourceAdded]: (d) => {
    const rows = Array.isArray(d.sources) ? (d.sources as { type?: string; title?: string; url?: string }[]) : [];
    const first = rows[0];
    if (!first) return `sources +${d.count ?? 1}`;
    const kind = first.type === SourceType.RatingFeedback ? 'ratings' : first.type === SourceType.Email ? 'email thread' : 'web';
    return `source (${kind}): ${String(first.title || first.url || '').slice(0, 60)}${rows.length > 1 ? ` (+${rows.length - 1})` : ''}`;
  },
  [EventType.InquiryUpdated]: (d) => {
    const name = typeof d.name === 'string' && d.name ? d.name : 'inquiry';
    const reason = d.reason ? ` — ${String(d.reason).slice(0, 70)}` : '';
    return `${name} → ${d.status ?? (typeof d.qualityScore === 'number' ? `quality ${Math.round(Number(d.qualityScore) * 100)}` : 'updated')}${reason}`;
  },
  [EventType.WaveReleased]: (d) => `wave ${d.wave} released (${d.count})`,
  [EventType.FunnelWidened]: (d) => `funnel widened (+${d.added})`,
  [EventType.MessageSent]: () => 'emailed a provider',
  [EventType.MessageReceived]: () => 'reply received',
  [EventType.RunReaped]: (d) => `recovered a stalled step (${d.action})`,
  [EventType.ReportTransitioned]: (d) => `→ ${d.to}`,
  [EventType.AgentProgress]: (d) => `${d.stage}: ${d.message}`,
  [EventType.ModelUsed]: (d) => {
    const version = d.modelVersion && d.modelVersion !== d.model ? ` (${d.modelVersion})` : '';
    return `model engaged: ${d.model}${version}${d.tier ? ` · ${d.tier}` : ''}`;
  },
};
const STREAM_ICON: Record<string, { icon: string; tone: StatusTone }> = {
  [EventType.ModelUsed]: { icon: '⚙', tone: StatusTone.Info },
  [EventType.EpicCreated]: { icon: '◆', tone: StatusTone.Info },
  [EventType.InquiryCreated]: { icon: '＋', tone: StatusTone.Muted },
  [EventType.SourceAdded]: { icon: '⌕', tone: StatusTone.Muted },
  [EventType.InquiryUpdated]: { icon: '↻', tone: StatusTone.Info },
  [EventType.WaveReleased]: { icon: '⇧', tone: StatusTone.Brand },
  [EventType.FunnelWidened]: { icon: '⊕', tone: StatusTone.Info },
  [EventType.MessageSent]: { icon: '✉', tone: StatusTone.Info },
  [EventType.MessageReceived]: { icon: '↩', tone: StatusTone.Brand },
  [EventType.RunReaped]: { icon: '⚠', tone: StatusTone.Warn },
  [EventType.ReportTransitioned]: { icon: '→', tone: StatusTone.Muted },
  [EventType.AgentProgress]: { icon: '•', tone: StatusTone.Muted },
};
const STREAM_FALLBACK = { icon: '•', tone: StatusTone.Muted };

function ActivityStream({ board }: { board: AdminBoardState }) {
  const rows = board.events.filter((e) => e.type !== EventType.AgentHeartbeat).slice(-80).reverse();
  return (
    <aside style={{ width: 300, flex: 'none', background: color.surface, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '16px 16px 8px', position: 'sticky', top: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
        <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: color.subtle, letterSpacing: '.04em', textTransform: 'uppercase' }}>Agent activity</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color.brand, animation: 'inqi-pulse 1.3s ease-in-out infinite' }} />
      </div>
      <div data-testid="activity-stream" style={{ maxHeight: 560, overflow: 'auto' }}>
        {rows.length === 0 && <div style={{ color: color.subtle, fontSize: fontSize.sm, paddingBottom: 12 }}>Waiting for activity…</div>}
        {rows.map((e) => {
          const ic = STREAM_ICON[e.type] ?? STREAM_FALLBACK;
          const tone = toneColors[ic.tone];
          return (
            <div key={e.id} style={{ display: 'flex', gap: 10, paddingBottom: 15 }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSize.xs, background: tone.bg, color: tone.fg }}>{ic.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: color.inkSoft, lineHeight: 1.4 }}>{(STREAM_LABEL[e.type] ?? (() => e.type))(e.data)}</div>
                <div style={{ fontSize: fontSize.xs, color: color.subtle, marginTop: 2, fontFamily: font.mono }}>{e.at && e.at !== 'now' ? new Date(e.at).toLocaleTimeString() : 'now'}</div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
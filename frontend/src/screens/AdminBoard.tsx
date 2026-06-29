import { useEffect, useState } from 'react';
import { EventType, SubtaskStatus } from '@inqi/shared';
import { AsyncStatus, StatusTone } from '../conventions/enums';
import { Route, navigate, hrefFor } from '../conventions/routes';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { inquiriesApi } from '../api';
import { InquiryDto } from '../api/types';
import { Card, Badge, StatusBadge, StatusDot, MonoRef, EmptyState, Skeleton, Button } from '../ui';
import { ButtonVariant } from '../conventions/enums';
import { toneForInquiryState, toneForSubtaskStatus } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';
import { AdminBoardState, EpicVM, epicSubtasks, epicNeedsAttention, epicProgress } from '../state/adminBoard.reducer';
import { RunControlsPanel } from './RunControls';

/** FE-10 — operator live board for one inquiry: epics → subtasks → findings + activity stream. */
export function AdminBoard({ inquiryId }: { inquiryId?: string }) {
  const dispatch = useAppDispatch();
  const board = useSelector((s) => s.adminBoard);
  const [tabs, setTabs] = useState<InquiryDto[]>([]);
  const activeId = inquiryId ?? tabs[0]?.id ?? null;

  // Inquiry tabs (nav). Lightweight list, not board state.
  useEffect(() => { inquiriesApi.list().then((rows) => setTabs(Array.isArray(rows) ? rows : [])).catch(() => undefined); }, []);

  // Board detail for the active inquiry.
  useEffect(() => { if (activeId) inquiriesApi.detail({ id: activeId }).then((b) => dispatch({ type: ActionType.AdminBoardLoaded, board: b })).catch(() => undefined); }, [activeId, dispatch]);

  // Admin room → reducer (the reducer scopes events to the active inquiry).
  useRealtime({ kind: 'admin' });

  return (
    <section style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: space[5] }}>
      <div style={{ display: 'grid', gap: space[4] }}>
        <Tabs tabs={tabs} activeId={activeId} />
        {board.status !== AsyncStatus.Ready || board.inquiryId !== activeId
          ? <Card><Skeleton width="50%" /></Card>
          : <Board board={board} />}
      </div>
      <ActivityStream board={board} />
    </section>
  );
}

function Tabs({ tabs, activeId }: { tabs: InquiryDto[]; activeId: string | null }) {
  if (!tabs.length) return null;
  return (
    <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => navigate({ route: Route.AdminInquiry, params: { id: t.id } })}
          style={{ border: `1px solid ${t.id === activeId ? color.brand : color.lineStrong}`, background: t.id === activeId ? color.brandTint : color.surface, color: t.id === activeId ? color.brandStrong : color.inkSoft, borderRadius: radius.pill, padding: `${space[1]}px ${space[3]}px`, fontSize: fontSize.sm, cursor: 'pointer' }}>
          <MonoRef muted>#{t.id.slice(0, 6)}</MonoRef> {t.rawRequest.slice(0, 28)}
        </button>
      ))}
    </div>
  );
}

function Board({ board }: { board: AdminBoardState }) {
  const [openEpic, setOpenEpic] = useState<string | null>(null);
  return (
    <div style={{ display: 'grid', gap: space[3] }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
        <h1 style={{ fontSize: fontSize.h3, flex: 1 }}>{board.title}</h1>
        {board.inquiryId && <a href={hrefFor({ route: Route.AdminCost, params: { id: board.inquiryId } })} style={{ fontSize: fontSize.sm }} data-testid="cost-link">cost →</a>}
        <StatusBadge label={board.inquiryState} tone={toneForInquiryState(board.inquiryState)} />
      </header>

      <RunControlsPanel board={board} />

      {board.epicOrder.length === 0 && <EmptyState title="No epics yet" hint="Epics + subtasks appear here as the agent works." />}

      {board.epicOrder.map((id) => {
        const epic = board.epicsById[id];
        return openEpic === id
          ? <EpicDetail key={id} board={board} epic={epic} onClose={() => setOpenEpic(null)} />
          : <EpicCard key={id} board={board} epic={epic} onOpen={() => setOpenEpic(id)} />;
      })}
    </div>
  );
}

function EpicCard({ board, epic, onOpen }: { board: AdminBoardState; epic: EpicVM; onOpen: () => void }) {
  const subs = epicSubtasks(board, epic.id);
  const attention = epicNeedsAttention(board, epic.id);
  const { qualified, target } = epicProgress(board, epic.id);
  return (
    <Card style={{ cursor: 'pointer' }}>
      <div role="button" data-testid="epic-card" onClick={onOpen} style={{ display: 'grid', gap: space[2] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          <b style={{ flex: 1 }}>{epic.strategy} epic</b>
          {attention && <Badge tone={StatusTone.Danger}>{subs.filter((s) => s.status === SubtaskStatus.Failed).length} need attention</Badge>}
          <span style={{ fontSize: fontSize.sm, color: color.muted }}>{qualified}/{target} qualified</span>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {subs.map((s) => <StatusDot key={s.id} tone={toneForSubtaskStatus(s.status)} />)}
          {subs.length === 0 && <span style={{ fontSize: fontSize.xs, color: color.subtle }}>no subtasks yet</span>}
        </div>
      </div>
    </Card>
  );
}

function EpicDetail({ board, epic, onClose }: { board: AdminBoardState; epic: EpicVM; onClose: () => void }) {
  const subs = epicSubtasks(board, epic.id);
  const step = (label: string, value: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: space[2], fontSize: fontSize.sm }}>
      <span style={{ color: color.muted }}>{label}</span><span>{value}</span>
    </div>
  );
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[3] }}>
        <b style={{ flex: 1 }}>{epic.strategy} epic</b>
        <Button variant={ButtonVariant.Ghost} onClick={onClose}>← list</Button>
      </div>
      <div style={{ display: 'grid', gap: space[1], marginBottom: space[3], paddingBottom: space[3], borderBottom: `1px solid ${color.line}` }}>
        {step('User request', board.lineage.userRequest)}
        {step('Initial research', board.lineage.initialResearch)}
        {step('Confirmed scope', board.lineage.confirmedScope)}
      </div>
      <div style={{ display: 'grid', gap: space[1] }}>
        {subs.map((s) => (
          <a key={s.id} href={hrefFor({ route: Route.AdminSubtask, params: { id: s.id } })} data-testid="subtask-row"
            style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: space[2], alignItems: 'center', padding: `${space[1]}px ${space[2]}px`, border: `1px solid ${color.line}`, borderRadius: 8, textDecoration: 'none', color: 'inherit' }}>
            <StatusDot tone={toneForSubtaskStatus(s.status)} />
            <span style={{ fontSize: fontSize.sm }}>{s.provider} <MonoRef muted>· w{s.wave}</MonoRef></span>
            <StatusBadge label={s.status} tone={toneForSubtaskStatus(s.status)} />
          </a>
        ))}
        {subs.length === 0 && <span style={{ fontSize: fontSize.sm, color: color.subtle }}>No subtasks yet.</span>}
      </div>
    </Card>
  );
}

const STREAM_LABEL: Record<string, (d: Record<string, unknown>) => string> = {
  [EventType.EpicCreated]: (d) => `epic created (${d.strategy})`,
  [EventType.SubtaskCreated]: (d) => `subtask: ${d.subjectProviderName}`,
  [EventType.SubtaskUpdated]: (d) => `subtask → ${d.status ?? `quality ${d.qualityScore}`}`,
  [EventType.WaveReleased]: (d) => `wave ${d.wave} released (${d.count})`,
  [EventType.FunnelWidened]: (d) => `funnel widened (+${d.added})`,
  [EventType.MessageSent]: () => 'emailed a provider',
  [EventType.MessageReceived]: () => 'reply received',
  [EventType.RunReaped]: (d) => `recovered a stalled step (${d.action})`,
  [EventType.InquiryTransitioned]: (d) => `→ ${d.to}`,
  [EventType.AgentProgress]: (d) => `${d.stage}: ${d.message}`,
};

function ActivityStream({ board }: { board: AdminBoardState }) {
  const rows = board.events.filter((e) => e.type !== EventType.AgentHeartbeat).slice(-80).reverse();
  return (
    <aside>
      <h3 style={{ fontSize: fontSize.h3, marginBottom: space[2] }}>Agent activity</h3>
      <div data-testid="activity-stream" style={{ maxHeight: 520, overflow: 'auto', fontSize: fontSize.xs, fontFamily: 'var(--font-mono)', background: color.surfaceSunken, border: `1px solid ${color.line}`, borderRadius: radius.md, padding: space[2] }}>
        {rows.length === 0 && <div style={{ color: color.subtle }}>Waiting for activity…</div>}
        {rows.map((e) => (
          <div key={e.id} style={{ padding: '2px 0' }}>
            <span style={{ color: color.subtle }}>{e.at && e.at !== 'now' ? new Date(e.at).toLocaleTimeString() : ''}</span>{' '}
            {(STREAM_LABEL[e.type] ?? (() => e.type))(e.data)}
          </div>
        ))}
      </div>
    </aside>
  );
}

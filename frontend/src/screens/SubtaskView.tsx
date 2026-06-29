import { useEffect } from 'react';
import { MessageDirection } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { scoreFor, subtaskOutreachVariant, showsChain, outreachNote, historyTone, OUTREACH_VARIANT_TONE, SubtaskRecord } from '../conventions/subtask';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { adminApi } from '../api';
import { ThreadMessageDto } from '../api/types';
import { Card, Badge, StatusBadge, StatusDot, MonoRef, EmptyState, Skeleton } from '../ui';
import { toneForSubtaskStatus, toneColors } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';

/** FE-11 — one subtask: system score (qualified-only), outreach exam, status history. */
export function SubtaskView({ subtaskId }: { subtaskId: string }) {
  const dispatch = useAppDispatch();
  const subtask = useSelector((s) => s.subtask);
  const boardRecord = useSelector((s) => s.adminBoard.subtasksById[subtaskId]);
  const inquiryId = useSelector((s) => s.adminBoard.inquiryId);
  const seenCount = Object.keys(subtask.seen).length;

  useRealtime({ kind: 'admin' });

  // Seed from the board record (FE-11 is opened from the board).
  useEffect(() => {
    if (boardRecord && (subtask.subtaskId !== subtaskId)) {
      const record: SubtaskRecord = { id: boardRecord.id, epicId: boardRecord.epicId, provider: boardRecord.provider, wave: boardRecord.wave, status: boardRecord.status, qualityScore: boardRecord.qualityScore, personaId: boardRecord.personaId };
      dispatch({ type: ActionType.SubtaskLoaded, record, at: new Date().toISOString() });
    }
  }, [boardRecord, subtaskId, subtask.subtaskId, dispatch]);

  // Chain (admin) — refetch when any event for this subtask arrives (message.*, subtask.updated).
  useEffect(() => {
    adminApi.thread({ subtaskId }).then((messages) => dispatch({ type: ActionType.SubtaskChainLoaded, messages })).catch(() => undefined);
  }, [subtaskId, seenCount, dispatch]);

  const backHref = inquiryId ? hrefFor({ route: Route.AdminInquiry, params: { id: inquiryId } }) : hrefFor({ route: Route.Admin });

  if (subtask.subtaskId !== subtaskId || subtask.status !== AsyncStatus.Ready || !subtask.record) {
    if (!boardRecord) return <EmptyState title="Open this from the board" hint="Subtask details load from the live board." action={<a href={backHref}>‹ Back to board</a>} />;
    return <Card><Skeleton width="40%" /></Card>;
  }

  const record = subtask.record;
  const score = scoreFor(record);
  const variant = subtaskOutreachVariant({ status: record.status, chain: subtask.chain });

  return (
    <div style={{ display: 'grid', gap: space[4] }} data-testid="subtask-view">
      <a href={backHref} style={{ fontSize: fontSize.sm }}>‹ Back to board</a>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          <h1 style={{ fontSize: fontSize.h2, flex: 1 }}>{record.provider}</h1>
          <StatusBadge label={record.status} tone={toneForSubtaskStatus(record.status)} />
        </div>
        <div style={{ fontSize: fontSize.sm, color: color.muted, marginTop: space[1] }}>
          <MonoRef muted>#{record.id.slice(0, 10)}</MonoRef> · wave {record.wave}{record.personaId ? <> · {record.personaId}</> : null}
        </div>
      </Card>

      <Card>
        <h3 style={{ fontSize: fontSize.h3, marginBottom: space[2] }}>System score</h3>
        {score ? (
          <div style={{ display: 'grid', gap: space[2] }} data-testid="score">
            <ScoreRow label="Feedback" value={score.feedbackScore} />
            <ScoreRow label="Blended" value={score.blendedScore} />
            {inquiryId && <a href={hrefFor({ route: Route.AdminDossier, params: { id: inquiryId, ref: record.provider } })} data-testid="dossier-link">view research dossier →</a>}
          </div>
        ) : (
          <div style={{ color: color.muted, fontSize: fontSize.sm }} data-testid="not-scored">Not scored yet — only qualified subtasks are scored.</div>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: space[2], marginBottom: space[2] }}>
          <h3 style={{ fontSize: fontSize.h3, flex: 1 }}>Outreach examination</h3>
          <a href={hrefFor({ route: Route.AdminThread, params: { id: record.id } })} style={{ fontSize: fontSize.sm }} data-testid="thread-link">full thread →</a>
        </div>
        <div style={{ display: 'flex', gap: space[2], alignItems: 'center', marginBottom: space[2] }}>
          <Badge tone={OUTREACH_VARIANT_TONE[variant]}>{variant}</Badge>
          <MonoRef muted>✉ via inqi</MonoRef>
        </div>
        {showsChain(variant)
          ? <Chain messages={subtask.chain ?? []} />
          : <div style={{ color: color.muted, fontSize: fontSize.sm }} data-testid="outreach-note">{outreachNote(variant)}</div>}
      </Card>

      <Card>
        <h3 style={{ fontSize: fontSize.h3, marginBottom: space[2] }}>Status history</h3>
        <ol data-testid="history" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: space[2] }}>
          {subtask.history.map((h, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: space[2], fontSize: fontSize.sm }}>
              <StatusDot tone={historyTone(h.status)} />
              <span style={{ color: toneColors[historyTone(h.status)].fg, fontWeight: fontWeight.medium }}>{h.status}</span>
              <span style={{ color: color.subtle }}>{h.at && h.at !== 'now' ? new Date(h.at).toLocaleString() : ''}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space[2], fontSize: fontSize.sm }}>
      <span style={{ width: 90, color: color.muted }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: color.surfaceSunken, borderRadius: radius.pill }}>
        <div style={{ width: `${Math.round(value * 100)}%`, height: 6, background: color.brand, borderRadius: radius.pill }} />
      </div>
      <span style={{ width: 40, textAlign: 'right' }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

function Chain({ messages }: { messages: ThreadMessageDto[] }) {
  if (!messages.length) return <div style={{ color: color.subtle, fontSize: fontSize.sm }}>Loading thread…</div>;
  return (
    <div data-testid="chain" style={{ display: 'grid', gap: space[2] }}>
      {messages.map((m) => (
        <div key={m.id} style={{ borderLeft: `3px solid ${m.direction === MessageDirection.Outbound ? color.info : color.brand}`, paddingLeft: space[3] }}>
          <MonoRef muted>{m.direction} · {m.status}</MonoRef>
          <div style={{ fontSize: fontSize.sm }}>{m.body}</div>
        </div>
      ))}
    </div>
  );
}

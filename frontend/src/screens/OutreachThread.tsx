import { useEffect } from 'react';
import { AsyncStatus } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { bubbleVM, threadHeaderVM, bubbleTone, bubbleAlign } from '../conventions/thread';
import { color, space, fontSize, fontWeight, radius } from '../theme/tokens';
import { adminApi } from '../api';
import { ThreadMessageDto } from '../api/types';
import { Card, StatusBadge, Badge, MonoRef, EmptyState, Skeleton } from '../ui';
import { toneColors, toneForInquiryStatus } from '../ui/tone';
import { useAppDispatch, useSelector } from '../state/store';
import { ActionType } from '../state/actions';
import { useRealtime } from '../realtime/socket';

/** FE-17 — operator outreach thread: one inquiry's persona-owned email conversation, live. */
export function OutreachThread({ inquiryId }: { inquiryId: string }) {
  const dispatch = useAppDispatch();
  const thread = useSelector((s) => s.thread);
  const record = useSelector((s) => s.adminBoard.inquiriesById[inquiryId]);
  const reportId = useSelector((s) => s.adminBoard.reportId);
  const seenCount = Object.keys(thread.seen).length;

  useRealtime({ kind: 'admin' });

  // Load the thread for this inquiry.
  useEffect(() => {
    adminApi.thread({ inquiryId }).then((messages) => dispatch({ type: ActionType.ThreadLoaded, inquiryId, messages })).catch(() => undefined);
  }, [inquiryId, dispatch]);

  // A message.* event for this inquiry bumps `seen` → refetch the authoritative thread
  // (the live backend events are thin: no message id/body).
  useEffect(() => {
    if (!seenCount) return;
    adminApi.thread({ inquiryId }).then((messages) => dispatch({ type: ActionType.ThreadLoaded, inquiryId, messages })).catch(() => undefined);
  }, [seenCount, inquiryId, dispatch]);

  const backHref = reportId ? hrefFor({ route: Route.AdminReport, params: { id: reportId } }) : hrefFor({ route: Route.Admin });

  if (thread.inquiryId !== inquiryId || thread.status !== AsyncStatus.Ready) {
    return <Card><Skeleton width="40%" /></Card>;
  }

  const header = threadHeaderVM({ record, messages: thread.messages });

  return (
    <div style={{ display: 'grid', gap: space[4] }} data-testid="outreach-thread">
      <a href={backHref} style={{ fontSize: fontSize.sm }} data-testid="thread-back">‹ Live board</a>

      <Card testId="thread-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          <h1 style={{ fontSize: fontSize.h2, flex: 1 }}>{header.provider}</h1>
          <StatusBadge label={header.status} tone={toneForInquiryStatus(header.status)} />
        </div>
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', alignItems: 'center', marginTop: space[2] }}>
          <Badge>persona {header.persona}</Badge>
          <MonoRef muted>hub {header.hub}</MonoRef>
        </div>
        <div style={{ fontSize: fontSize.sm, color: color.muted, marginTop: space[1] }}>
          <MonoRef muted>✉ {header.route}</MonoRef>
        </div>
      </Card>

      {thread.messages.length === 0
        ? <EmptyState title="Not contacted yet" hint="This inquiry is queued — no email has been sent." />
        : (
          <div data-testid="thread-bubbles" style={{ display: 'grid', gap: space[3] }}>
            {thread.messages.map((m) => <Bubble key={m.id} message={m} />)}
          </div>
        )}
    </div>
  );
}

function Bubble({ message }: { message: ThreadMessageDto }) {
  const vm = bubbleVM({ message });
  const c = toneColors[bubbleTone(vm.outbound)];
  return (
    <div style={{ display: 'flex', justifyContent: bubbleAlign(vm.outbound) }} data-testid="bubble" data-direction={vm.direction}>
      <div style={{ maxWidth: '76%', background: c.bg, border: `1px solid ${c.border}`, borderRadius: radius.lg, padding: space[3] }}>
        <div style={{ display: 'flex', gap: space[2], justifyContent: 'space-between', marginBottom: space[1] }}>
          <MonoRef muted>{vm.outbound ? '→' : '←'} {vm.address}</MonoRef>
          <MonoRef muted>{vm.at && vm.at !== 'now' ? new Date(vm.at).toLocaleString() : ''}</MonoRef>
        </div>
        <div style={{ fontSize: fontSize.sm, color: color.ink, whiteSpace: 'pre-wrap' }}>{message.body}</div>
        <div style={{ fontSize: fontSize.xs, color: c.fg, fontWeight: fontWeight.medium, marginTop: space[1] }}>{vm.outbound ? 'outbound' : 'inbound'}</div>
      </div>
    </div>
  );
}

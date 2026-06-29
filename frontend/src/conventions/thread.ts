import { MessageDirection, EventType, InqiEvent } from '@inqi/shared';
import { StatusTone } from './enums';
import { ThreadMessageDto } from '../api/types';
import { SubtaskRecord } from './subtask';

/**
 * FE-17 — operator outreach thread. The real `GET /comms/thread/:subtaskId` returns
 * a flat MessageDto[] (no ThreadDTO header); the header is composed from the board
 * record + the messages' addresses. Ordering/append/normalization live here
 * (convention #2); the component is a pure view.
 */

/** Chronological, deduped by id (the thread is the source of truth). */
export function sortThread({ messages }: { messages: ThreadMessageDto[] }): ThreadMessageDto[] {
  const byId = new Map<string, ThreadMessageDto>();
  for (const m of messages) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Append one message, idempotent by id, keeping the thread sorted. */
export function appendThreadMessage({ messages, message }: { messages: ThreadMessageDto[]; message: ThreadMessageDto }): ThreadMessageDto[] {
  if (messages.some((m) => m.id === message.id)) return messages;
  return sortThread({ messages: [...messages, message] });
}

/**
 * Build a ThreadMessageDto from a realtime event when it carries the message
 * (forward-compatible). The live backend events are thin (`{to}`/`{from}` only),
 * so the component also refetches on a message.* event — this is the direct-append
 * path the reducer can take when the payload is rich enough.
 */
export function messageDtoFromEvent({ event }: { event: InqiEvent }): ThreadMessageDto | null {
  if (event.type !== EventType.MessageSent && event.type !== EventType.MessageReceived) return null;
  const d = (event.data ?? {}) as Partial<ThreadMessageDto> & { address?: string; at?: string };
  if (!d.id || !d.body) return null;
  const direction = event.type === EventType.MessageSent ? MessageDirection.Outbound : MessageDirection.Inbound;
  return {
    id: d.id,
    subtaskId: event.subtaskId ?? d.subtaskId ?? '',
    direction: d.direction ?? direction,
    status: d.status ?? ('sent' as ThreadMessageDto['status']),
    fromAddr: d.fromAddr ?? null,
    toAddr: d.toAddr ?? null,
    subject: d.subject ?? null,
    body: d.body,
    createdAt: d.createdAt ?? d.at ?? event.at,
  };
}

export interface BubbleVM { id: string; direction: MessageDirection; address: string; at: string; body: string; outbound: boolean }

/** One message → a direction-aligned bubble view-model. `address` is the external party. */
export function bubbleVM({ message }: { message: ThreadMessageDto }): BubbleVM {
  const outbound = message.direction === MessageDirection.Outbound;
  const address = (outbound ? message.toAddr : message.fromAddr) ?? '—';
  return { id: message.id, direction: message.direction, address, at: message.createdAt, body: message.body, outbound };
}

export interface ThreadHeaderVM { provider: string; persona: string; hub: string; route: string; status: string }

/** Compose the header from the board record + the messages (route/hub from addresses). */
export function threadHeaderVM({ record, messages }: { record?: SubtaskRecord | null; messages: ThreadMessageDto[] }): ThreadHeaderVM {
  const firstOutbound = messages.find((m) => m.direction === MessageDirection.Outbound);
  const replyAddr = firstOutbound?.fromAddr ?? null; // the persona's inqi reply route
  const providerAddr = firstOutbound?.toAddr ?? messages[0]?.fromAddr ?? null;
  return {
    provider: record?.provider ?? providerAddr ?? '—',
    persona: record?.personaId ?? '—',
    status: record?.status ?? '—',
    hub: replyAddr ? (replyAddr.split('@')[1] ?? replyAddr) : '—',
    route: replyAddr && providerAddr ? `${replyAddr} → ${providerAddr}` : (providerAddr ?? '—'),
  };
}

/** Outbound aligns right (brand), inbound aligns left (info). */
export function bubbleTone(outbound: boolean): StatusTone {
  return outbound ? StatusTone.Brand : StatusTone.Info;
}
export function bubbleAlign(outbound: boolean): 'flex-start' | 'flex-end' {
  return outbound ? 'flex-end' : 'flex-start';
}

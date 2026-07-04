import { describe, it, expect } from 'vitest';
import { MessageDirection, EventType, MessageStatus, InqiEvent } from '@inqi/shared';
import { sortThread, appendThreadMessage, messageDtoFromEvent, bubbleVM, threadHeaderVM } from './thread';
import { ThreadMessageDto } from '../api/types';
import { InquiryRecord } from './inquiry';

const msg = (over: Partial<ThreadMessageDto>): ThreadMessageDto => ({ id: 'm', inquiryId: 's1', direction: MessageDirection.Outbound, status: MessageStatus.Sent, fromAddr: 'p@reply.inqi.io', toAddr: 'sales@acme.io', body: 'hi', createdAt: '2026-06-28T12:00:00Z', ...over });

describe('sortThread — chronological + deduped by id', () => {
  it('orders by createdAt and removes duplicate ids', () => {
    const out = sortThread({ messages: [
      msg({ id: 'b', createdAt: '2026-06-28T13:00:00Z' }),
      msg({ id: 'a', createdAt: '2026-06-28T12:00:00Z' }),
      msg({ id: 'a', createdAt: '2026-06-28T12:00:00Z' }), // dup
    ] });
    expect(out.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('appendThreadMessage — idempotent by id', () => {
  it('appends a new message in order; ignores a duplicate id', () => {
    const base = [msg({ id: 'a', createdAt: '2026-06-28T12:00:00Z' })];
    const withB = appendThreadMessage({ messages: base, message: msg({ id: 'b', direction: MessageDirection.Inbound, createdAt: '2026-06-28T13:00:00Z' }) });
    expect(withB.map((m) => m.id)).toEqual(['a', 'b']);
    const again = appendThreadMessage({ messages: withB, message: msg({ id: 'b', createdAt: '2026-06-28T13:00:00Z' }) });
    expect(again).toBe(withB); // no-op for a known id
  });
});

describe('messageDtoFromEvent', () => {
  const ev = (over: Partial<InqiEvent>): InqiEvent => ({ id: '1', type: EventType.MessageReceived, reportId: 'i1', inquiryId: 's1', at: '2026-06-28T14:00:00Z', data: {}, ...over });
  it('builds an inbound message when the payload carries it', () => {
    const m = messageDtoFromEvent({ event: ev({ data: { id: 'r1', body: 'In stock', fromAddr: 'sales@acme.io' } }) });
    expect(m).toMatchObject({ id: 'r1', direction: MessageDirection.Inbound, body: 'In stock' });
  });
  it('returns null for a thin live event (no id/body) and non-message events', () => {
    expect(messageDtoFromEvent({ event: ev({ data: { from: 'sales@acme.io' } }) })).toBeNull();
    expect(messageDtoFromEvent({ event: ev({ type: EventType.InquiryUpdated, data: { id: 'x', body: 'y' } }) })).toBeNull();
  });
});

describe('bubbleVM — direction-aligned address', () => {
  it('outbound shows the recipient; inbound shows the sender', () => {
    expect(bubbleVM({ message: msg({ direction: MessageDirection.Outbound }) })).toMatchObject({ outbound: true, address: 'sales@acme.io' });
    expect(bubbleVM({ message: msg({ direction: MessageDirection.Inbound }) })).toMatchObject({ outbound: false, address: 'p@reply.inqi.io' });
  });
});

describe('threadHeaderVM — composed from record + addresses', () => {
  const record: InquiryRecord = { id: 's1', epicId: 'e1', provider: 'Acme Bikes', wave: 1, status: 'replied', qualityScore: null, personaId: 'persona_amsterdam' };
  it('uses the record for provider/persona/status and derives route + hub from the outbound message', () => {
    const h = threadHeaderVM({ record, messages: [msg({ direction: MessageDirection.Outbound })] });
    expect(h).toMatchObject({ provider: 'Acme Bikes', persona: 'persona_amsterdam', status: 'replied', hub: 'reply.inqi.io', route: 'p@reply.inqi.io → sales@acme.io' });
  });
  it('falls back gracefully with no record / no messages', () => {
    expect(threadHeaderVM({ record: null, messages: [] })).toMatchObject({ provider: '—', persona: '—', hub: '—', route: '—' });
  });
});

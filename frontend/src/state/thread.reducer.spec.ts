import { describe, it, expect } from 'vitest';
import { MessageDirection, MessageStatus, EventType, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { ActionType } from './actions';
import { threadReducer, initialThreadState } from './thread.reducer';
import { ThreadMessageDto } from '../api/types';

const msg = (over: Partial<ThreadMessageDto>): ThreadMessageDto => ({ id: 'm', inquiryId: 's1', direction: MessageDirection.Outbound, status: MessageStatus.Sent, fromAddr: 'p@reply.io', toAddr: 'sales@acme.io', body: 'hi', createdAt: '2026-06-28T12:00:00Z', ...over });
const loaded = () => threadReducer(initialThreadState, { type: ActionType.ThreadLoaded, inquiryId: 's1', messages: [msg({ id: 'a' })] });
const ev = (over: Partial<InqiEvent>): InqiEvent => ({ id: '1', type: EventType.MessageReceived, reportId: 'i1', inquiryId: 's1', at: '2026-06-28T14:00:00Z', data: {}, ...over });

describe('threadReducer', () => {
  it('loads + sorts the thread', () => {
    const s = loaded();
    expect(s.status).toBe(AsyncStatus.Ready);
    expect(s.inquiryId).toBe('s1');
    expect(s.messages).toHaveLength(1);
  });

  it('appends an inbound message from a rich message.received, in order', () => {
    let s = loaded();
    s = threadReducer(s, { type: ActionType.EventReceived, event: ev({ id: '5', data: { id: 'r1', body: 'In stock', fromAddr: 'sales@acme.io', createdAt: '2026-06-28T13:00:00Z' } }) });
    expect(s.messages.map((m) => m.id)).toEqual(['a', 'r1']);
    expect(s.messages[1].direction).toBe(MessageDirection.Inbound);
  });

  it('is idempotent by event id and scoped to the inquiry', () => {
    let s = loaded();
    const e = ev({ id: '6', data: { id: 'r1', body: 'In stock', createdAt: '2026-06-28T13:00:00Z' } });
    s = threadReducer(s, { type: ActionType.EventReceived, event: e });
    s = threadReducer(s, { type: ActionType.EventReceived, event: e }); // duplicate event id
    expect(s.messages.filter((m) => m.id === 'r1')).toHaveLength(1);
    const before = s;
    const after = threadReducer(s, { type: ActionType.EventReceived, event: ev({ id: '7', inquiryId: 'other', data: { id: 'z', body: 'x' } }) });
    expect(after).toBe(before);
  });

  it('records a thin live event in `seen` (for refetch) without appending', () => {
    let s = loaded();
    s = threadReducer(s, { type: ActionType.EventReceived, event: ev({ id: '8', type: EventType.MessageReceived, data: { from: 'sales@acme.io' } }) });
    expect(Object.keys(s.seen)).toContain('8'); // bumps the refetch signal
    expect(s.messages).toHaveLength(1);          // nothing appended (no id/body)
  });

  it('switching inquiry resets the seen set', () => {
    let s = loaded();
    s = threadReducer(s, { type: ActionType.EventReceived, event: ev({ id: '9', data: { id: 'r1', body: 'x' } }) });
    s = threadReducer(s, { type: ActionType.ThreadLoaded, inquiryId: 's2', messages: [] });
    expect(s.inquiryId).toBe('s2');
    expect(s.seen).toEqual({});
  });
});

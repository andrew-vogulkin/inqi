import { describe, it, expect } from 'vitest';
import { EventType, InquiryStatus, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { InquiryRecord } from '../conventions/inquiry';
import { ActionType } from './actions';
import { inquiryReducer, initialInquiryState } from './inquiry.reducer';

const rec: InquiryRecord = { id: 's1', epicId: 'e1', provider: 'Aurora', wave: 1, status: InquiryStatus.Contacted, qualityScore: null };
const evt = (over: Partial<InqiEvent>): InqiEvent => ({ id: '1', type: EventType.InquiryUpdated, reportId: 'i1', inquiryId: 's1', at: 't', data: {}, ...over });
const loaded = () => inquiryReducer(initialInquiryState, { type: ActionType.InquiryLoaded, record: rec, at: '2026-06-29T00:00:00Z' });

describe('inquiryReducer', () => {
  it('seeds history from the loaded record', () => {
    const s = loaded();
    expect(s.status).toBe(AsyncStatus.Ready);
    expect(s.history).toEqual([{ status: InquiryStatus.Contacted, at: '2026-06-29T00:00:00Z' }]);
  });

  it('an inquiry.updated appends a history node + updates status/quality', () => {
    let s = loaded();
    s = inquiryReducer(s, { type: ActionType.EventReceived, event: evt({ id: '5', data: { status: InquiryStatus.Qualified, qualityScore: 0.9 } }) });
    expect(s.record?.status).toBe(InquiryStatus.Qualified);
    expect(s.record?.qualityScore).toBe(0.9);
    expect(s.history.map((h) => h.status)).toEqual([InquiryStatus.Contacted, InquiryStatus.Qualified]);
  });

  it('is idempotent by event id and ignores other inquiries', () => {
    let s = loaded();
    const e = evt({ id: '6', data: { status: InquiryStatus.Failed } });
    s = inquiryReducer(s, { type: ActionType.EventReceived, event: e });
    s = inquiryReducer(s, { type: ActionType.EventReceived, event: e }); // duplicate
    expect(s.history.filter((h) => h.status === InquiryStatus.Failed)).toHaveLength(1);
    const before = s;
    const after = inquiryReducer(s, { type: ActionType.EventReceived, event: evt({ id: '7', inquiryId: 'other', data: { status: InquiryStatus.Replied } }) });
    expect(after).toBe(before);
  });

  it('stores the loaded chain', () => {
    let s = loaded();
    s = inquiryReducer(s, { type: ActionType.InquiryChainLoaded, messages: [{ id: 'm1', inquiryId: 's1', direction: 'outbound', status: 'sent', body: 'hi', createdAt: 'now' }] });
    expect(s.chain).toHaveLength(1);
  });
});

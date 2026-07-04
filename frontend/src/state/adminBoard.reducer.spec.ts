import { describe, it, expect } from 'vitest';
import { EventType, InquiryStatus, InqiEvent } from '@inqi/shared';
import { AsyncStatus, ReportEventType } from '../conventions/enums';
import { ReportBoardDto } from '../api/types';
import { ActionType } from './actions';
import { adminBoardReducer, initialAdminBoardState, epicNeedsAttention, epicProgress, epicInquiries, AdminBoardState } from './adminBoard.reducer';

const board: ReportBoardDto = {
  id: 'i1', rawRequest: 'a road bike', state: 'OUTREACH', customerEmail: 'c@x.io',
  subject: { title: 'Road bike, 56cm' }, questionnaire: { confirmed: true },
  epics: [{ id: 'e1', strategy: 'escalating', status: 'open', targetQualifiedOptions: 3, releasedWaves: [1], inquiries: [
    { id: 's1', epicId: 'e1', name: 'Velohaus', wave: 1, status: InquiryStatus.Contacted },
    { id: 's2', epicId: 'e1', name: 'Fietsfabriek', wave: 1, status: InquiryStatus.Qualified },
  ] }],
};
const loaded = (): AdminBoardState => adminBoardReducer(initialAdminBoardState, { type: ActionType.AdminBoardLoaded, board });
const evt = (over: Partial<InqiEvent>): InqiEvent => ({ id: '1', type: EventType.AgentProgress, reportId: 'i1', at: 't', data: {}, ...over });

describe('adminBoardReducer — load', () => {
  it('builds epics → inquiries + lineage from the nested DTO', () => {
    const s = loaded();
    expect(s.status).toBe(AsyncStatus.Ready);
    expect(s.epicOrder).toEqual(['e1']);
    expect(epicInquiries(s, 'e1').map((x) => x.id)).toEqual(['s1', 's2']);
    expect(s.lineage).toMatchObject({ userRequest: 'a road bike', initialResearch: 'Road bike, 56cm', confirmedScope: 'Scope confirmed by the customer' });
    expect(epicProgress(s, 'e1')).toEqual({ qualified: 1, target: 3 });
  });
});

describe('adminBoardReducer — live merge', () => {
  it('merges inquiry.created + inquiry.updated (status transition)', () => {
    let s = loaded();
    s = adminBoardReducer(s, { type: ActionType.EventReceived, event: evt({ id: '10', type: EventType.InquiryCreated, epicId: 'e1', inquiryId: 's3', data: { name: 'Tweewieler', wave: 2 } }) });
    expect(epicInquiries(s, 'e1').map((x) => x.id)).toContain('s3');
    expect(s.inquiriesById.s3.status).toBe(InquiryStatus.Pending);
    s = adminBoardReducer(s, { type: ActionType.EventReceived, event: evt({ id: '11', type: EventType.InquiryUpdated, epicId: 'e1', inquiryId: 's3', data: { status: InquiryStatus.Qualified } }) });
    expect(s.inquiriesById.s3.status).toBe(InquiryStatus.Qualified);
    expect(epicProgress(s, 'e1').qualified).toBe(2);
  });

  it('"need attention" appears only with a failed inquiry', () => {
    let s = loaded();
    expect(epicNeedsAttention(s, 'e1')).toBe(false);
    s = adminBoardReducer(s, { type: ActionType.EventReceived, event: evt({ id: '12', type: EventType.InquiryUpdated, epicId: 'e1', inquiryId: 's1', data: { status: InquiryStatus.Failed } }) });
    expect(epicNeedsAttention(s, 'e1')).toBe(true);
  });

  it('wave.released records the wave; run.reaped + finding.added stream', () => {
    let s = loaded();
    s = adminBoardReducer(s, { type: ActionType.EventReceived, event: evt({ id: '13', type: EventType.WaveReleased, epicId: 'e1', data: { wave: 2, count: 3 } }) });
    expect(s.epicsById.e1.releasedWaves).toContain(2);
    s = adminBoardReducer(s, { type: ActionType.EventReceived, event: evt({ id: '14', type: EventType.RunReaped, data: { action: 'retry' } }) });
    s = adminBoardReducer(s, { type: ActionType.EventReceived, event: evt({ id: '15', type: ReportEventType.FindingAdded as unknown as EventType, inquiryId: 's2', data: { id: 'f1', kind: 'option' } }) });
    expect(s.findingsById.f1).toMatchObject({ kind: 'option' });
    expect(s.events.map((e) => e.id)).toEqual(['13', '14', '15']);
  });

  it('is idempotent by event id and ignores other reports', () => {
    let s = loaded();
    const e = evt({ id: '20', type: EventType.InquiryUpdated, epicId: 'e1', inquiryId: 's1', data: { status: InquiryStatus.Replied } });
    s = adminBoardReducer(s, { type: ActionType.EventReceived, event: e });
    s = adminBoardReducer(s, { type: ActionType.EventReceived, event: e }); // duplicate
    expect(s.events.filter((x) => x.id === '20')).toHaveLength(1);
    const before = s;
    const after = adminBoardReducer(s, { type: ActionType.EventReceived, event: evt({ id: '21', reportId: 'other', type: EventType.InquiryUpdated, inquiryId: 's1', data: { status: InquiryStatus.Failed } }) });
    expect(after).toBe(before); // unchanged
  });
});

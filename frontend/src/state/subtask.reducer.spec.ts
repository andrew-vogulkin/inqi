import { describe, it, expect } from 'vitest';
import { EventType, SubtaskStatus, InqiEvent } from '@inqi/shared';
import { AsyncStatus } from '../conventions/enums';
import { SubtaskRecord } from '../conventions/subtask';
import { ActionType } from './actions';
import { subtaskReducer, initialSubtaskState } from './subtask.reducer';

const rec: SubtaskRecord = { id: 's1', epicId: 'e1', provider: 'Aurora', wave: 1, status: SubtaskStatus.Contacted, qualityScore: null };
const evt = (over: Partial<InqiEvent>): InqiEvent => ({ id: '1', type: EventType.SubtaskUpdated, inquiryId: 'i1', subtaskId: 's1', at: 't', data: {}, ...over });
const loaded = () => subtaskReducer(initialSubtaskState, { type: ActionType.SubtaskLoaded, record: rec, at: '2026-06-29T00:00:00Z' });

describe('subtaskReducer', () => {
  it('seeds history from the loaded record', () => {
    const s = loaded();
    expect(s.status).toBe(AsyncStatus.Ready);
    expect(s.history).toEqual([{ status: SubtaskStatus.Contacted, at: '2026-06-29T00:00:00Z' }]);
  });

  it('a subtask.updated appends a history node + updates status/quality', () => {
    let s = loaded();
    s = subtaskReducer(s, { type: ActionType.EventReceived, event: evt({ id: '5', data: { status: SubtaskStatus.Qualified, qualityScore: 0.9 } }) });
    expect(s.record?.status).toBe(SubtaskStatus.Qualified);
    expect(s.record?.qualityScore).toBe(0.9);
    expect(s.history.map((h) => h.status)).toEqual([SubtaskStatus.Contacted, SubtaskStatus.Qualified]);
  });

  it('is idempotent by event id and ignores other subtasks', () => {
    let s = loaded();
    const e = evt({ id: '6', data: { status: SubtaskStatus.Failed } });
    s = subtaskReducer(s, { type: ActionType.EventReceived, event: e });
    s = subtaskReducer(s, { type: ActionType.EventReceived, event: e }); // duplicate
    expect(s.history.filter((h) => h.status === SubtaskStatus.Failed)).toHaveLength(1);
    const before = s;
    const after = subtaskReducer(s, { type: ActionType.EventReceived, event: evt({ id: '7', subtaskId: 'other', data: { status: SubtaskStatus.Replied } }) });
    expect(after).toBe(before);
  });

  it('stores the loaded chain', () => {
    let s = loaded();
    s = subtaskReducer(s, { type: ActionType.SubtaskChainLoaded, messages: [{ id: 'm1', subtaskId: 's1', direction: 'outbound', status: 'sent', body: 'hi', createdAt: 'now' }] });
    expect(s.chain).toHaveLength(1);
  });
});

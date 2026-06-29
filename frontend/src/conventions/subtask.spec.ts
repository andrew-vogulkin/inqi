import { describe, it, expect } from 'vitest';
import { SubtaskStatus, MessageStatus } from '@inqi/shared';
import { SubtaskOutreachVariant, StatusTone } from './enums';
import { scoreFor, subtaskOutreachVariant, showsChain, outreachNote, historyTone, SubtaskRecord } from './subtask';
import { ThreadMessageDto } from '../api/types';

const rec = (over: Partial<SubtaskRecord> = {}): SubtaskRecord => ({ id: 's1', epicId: 'e1', provider: 'Aurora', wave: 1, status: SubtaskStatus.Contacted, qualityScore: 0.8, ...over });
const msg = (status: string): ThreadMessageDto => ({ id: 'm', subtaskId: 's1', direction: 'outbound', status: status as ThreadMessageDto['status'], body: 'x', createdAt: 'now' });

describe('scoreFor — score gating', () => {
  it('returns a score only when qualified', () => {
    expect(scoreFor(rec({ status: SubtaskStatus.Qualified, qualityScore: 0.9 }))).toMatchObject({ feedbackScore: 0.9, blendedScore: 0.9 });
    expect(scoreFor(rec({ status: SubtaskStatus.Contacted }))).toBeNull();
    expect(scoreFor(rec({ status: SubtaskStatus.Pending }))).toBeNull();
  });
});

describe('subtaskOutreachVariant', () => {
  it('selects by status', () => {
    expect(subtaskOutreachVariant({ status: SubtaskStatus.Replied, chain: null })).toBe(SubtaskOutreachVariant.Replied);
    expect(subtaskOutreachVariant({ status: SubtaskStatus.Qualified, chain: null })).toBe(SubtaskOutreachVariant.Replied);
    expect(subtaskOutreachVariant({ status: SubtaskStatus.Contacted, chain: null })).toBe(SubtaskOutreachVariant.Contacted);
    expect(subtaskOutreachVariant({ status: SubtaskStatus.Pending, chain: null })).toBe(SubtaskOutreachVariant.Queued);
    expect(subtaskOutreachVariant({ status: SubtaskStatus.Failed, chain: null })).toBe(SubtaskOutreachVariant.Error);
    expect(subtaskOutreachVariant({ status: SubtaskStatus.Skipped, chain: null })).toBe(SubtaskOutreachVariant.Canceled);
  });
  it('a 550 bounce in the chain overrides the status', () => {
    expect(subtaskOutreachVariant({ status: SubtaskStatus.Contacted, chain: [msg(MessageStatus.Sent), msg(MessageStatus.Bounced)] })).toBe(SubtaskOutreachVariant.Bounced);
  });
  it('chain-vs-note: contacted/replied show the chain, others a note', () => {
    expect(showsChain(SubtaskOutreachVariant.Contacted)).toBe(true);
    expect(showsChain(SubtaskOutreachVariant.Replied)).toBe(true);
    expect(showsChain(SubtaskOutreachVariant.Bounced)).toBe(false);
    expect(outreachNote(SubtaskOutreachVariant.Bounced)).toContain('550');
  });
});

describe('historyTone — node colour by status', () => {
  it('maps qualified→brand, failed→danger, skipped→subtle, contacted→info', () => {
    expect(historyTone(SubtaskStatus.Qualified)).toBe(StatusTone.Brand);
    expect(historyTone(SubtaskStatus.Failed)).toBe(StatusTone.Danger);
    expect(historyTone(SubtaskStatus.Skipped)).toBe(StatusTone.Subtle);
    expect(historyTone(SubtaskStatus.Contacted)).toBe(StatusTone.Info);
  });
});

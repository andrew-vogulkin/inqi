import { describe, it, expect } from 'vitest';
import { InquiryStatus, MessageStatus } from '@inqi/shared';
import { InquiryOutreachVariant, StatusTone } from './enums';
import { scoreFor, inquiryOutreachVariant, showsChain, outreachNote, historyTone, InquiryRecord } from './inquiry';
import { ThreadMessageDto } from '../api/types';

const rec = (over: Partial<InquiryRecord> = {}): InquiryRecord => ({ id: 's1', epicId: 'e1', provider: 'Aurora', wave: 1, status: InquiryStatus.Contacted, qualityScore: 0.8, ...over });
const msg = (status: string): ThreadMessageDto => ({ id: 'm', inquiryId: 's1', direction: 'outbound', status: status as ThreadMessageDto['status'], body: 'x', createdAt: 'now' });

describe('scoreFor — score gating', () => {
  it('returns a score only when qualified', () => {
    expect(scoreFor(rec({ status: InquiryStatus.Qualified, qualityScore: 0.9 }))).toMatchObject({ feedbackScore: 0.9, blendedScore: 0.9 });
    expect(scoreFor(rec({ status: InquiryStatus.Contacted }))).toBeNull();
    expect(scoreFor(rec({ status: InquiryStatus.Pending }))).toBeNull();
  });
});

describe('inquiryOutreachVariant', () => {
  it('selects by status', () => {
    expect(inquiryOutreachVariant({ status: InquiryStatus.Replied, chain: null })).toBe(InquiryOutreachVariant.Replied);
    expect(inquiryOutreachVariant({ status: InquiryStatus.Qualified, chain: null })).toBe(InquiryOutreachVariant.Replied);
    expect(inquiryOutreachVariant({ status: InquiryStatus.Contacted, chain: null })).toBe(InquiryOutreachVariant.Contacted);
    expect(inquiryOutreachVariant({ status: InquiryStatus.Pending, chain: null })).toBe(InquiryOutreachVariant.Queued);
    expect(inquiryOutreachVariant({ status: InquiryStatus.Failed, chain: null })).toBe(InquiryOutreachVariant.Error);
    expect(inquiryOutreachVariant({ status: InquiryStatus.Skipped, chain: null })).toBe(InquiryOutreachVariant.Canceled);
  });
  it('a 550 bounce in the chain overrides the status', () => {
    expect(inquiryOutreachVariant({ status: InquiryStatus.Contacted, chain: [msg(MessageStatus.Sent), msg(MessageStatus.Bounced)] })).toBe(InquiryOutreachVariant.Bounced);
  });
  it('chain-vs-note: contacted/replied show the chain, others a note', () => {
    expect(showsChain(InquiryOutreachVariant.Contacted)).toBe(true);
    expect(showsChain(InquiryOutreachVariant.Replied)).toBe(true);
    expect(showsChain(InquiryOutreachVariant.Bounced)).toBe(false);
    expect(outreachNote(InquiryOutreachVariant.Bounced)).toContain('550');
  });
});

describe('historyTone — node colour by status', () => {
  it('maps qualified→brand, failed→danger, skipped→subtle, contacted→info', () => {
    expect(historyTone(InquiryStatus.Qualified)).toBe(StatusTone.Brand);
    expect(historyTone(InquiryStatus.Failed)).toBe(StatusTone.Danger);
    expect(historyTone(InquiryStatus.Skipped)).toBe(StatusTone.Subtle);
    expect(historyTone(InquiryStatus.Contacted)).toBe(StatusTone.Info);
  });
});

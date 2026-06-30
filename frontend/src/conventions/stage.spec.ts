import { describe, it, expect } from 'vitest';
import { InquiryState, InquiryStage, PARTIAL_READY_MIN, READY_MIN } from '@inqi/shared';
import { deriveStage, stageForInquiry, stageBadge } from './stages';

describe('deriveStage (HP-23)', () => {
  it('projects workflow state when below the partial-ready threshold', () => {
    expect(deriveStage({ state: InquiryState.RECEIVED, qualifiedCount: 0 })).toBe(InquiryStage.Draft);
    expect(deriveStage({ state: InquiryState.PRE_RESEARCH, qualifiedCount: 0 })).toBe(InquiryStage.Preparing);
    expect(deriveStage({ state: InquiryState.QUESTIONNAIRE_SENT, qualifiedCount: 0 })).toBe(InquiryStage.Questionnaire);
    expect(deriveStage({ state: InquiryState.OUTREACH, qualifiedCount: 1 })).toBe(InquiryStage.Researching);
  });

  it('crosses to Partially ready at the threshold and Ready at READY_MIN', () => {
    expect(deriveStage({ state: InquiryState.OUTREACH, qualifiedCount: PARTIAL_READY_MIN })).toBe(InquiryStage.PartiallyReady);
    expect(deriveStage({ state: InquiryState.OUTREACH, qualifiedCount: PARTIAL_READY_MIN - 1 })).toBe(InquiryStage.Researching);
    expect(deriveStage({ state: InquiryState.OUTREACH, qualifiedCount: READY_MIN })).toBe(InquiryStage.Ready);
    expect(deriveStage({ state: InquiryState.OUTREACH, qualifiedCount: READY_MIN - 1 })).toBe(InquiryStage.PartiallyReady);
  });

  it('a delivered report is always Ready, even below READY_MIN', () => {
    expect(deriveStage({ state: InquiryState.REPORT_DELIVERED, qualifiedCount: 1 })).toBe(InquiryStage.Ready);
  });

  it('thresholds are config-overridable', () => {
    expect(deriveStage({ state: InquiryState.OUTREACH, qualifiedCount: 3, thresholds: { partialReadyMin: 1, readyMin: 3 } })).toBe(InquiryStage.Ready);
  });

  it('stageForInquiry trusts the backend stage over re-deriving', () => {
    expect(stageForInquiry({ state: InquiryState.OUTREACH, stage: InquiryStage.Ready, qualifiedCount: 0 })).toBe(InquiryStage.Ready);
    expect(stageForInquiry({ state: InquiryState.OUTREACH, qualifiedCount: 2 })).toBe(InquiryStage.PartiallyReady);
  });

  it('stageBadge follows the stage on the happy path; terminal/hold states win', () => {
    expect(stageBadge({ stage: InquiryStage.PartiallyReady, state: InquiryState.OUTREACH }).label).toBe('Partially ready');
    expect(stageBadge({ stage: InquiryStage.Researching, state: InquiryState.ON_HOLD }).label).toBe('On hold');
    expect(stageBadge({ stage: InquiryStage.Researching, state: InquiryState.CANCELLED }).label).toBe('Cancelled');
  });
});

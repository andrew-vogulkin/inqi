import { InquiryState, WorkflowEvent, failureEventForState } from '@inqi/shared';

describe('failureEventForState', () => {
  it('maps each processing state to its failure/stall event', () => {
    expect(failureEventForState(InquiryState.PRE_RESEARCH)).toBe(WorkflowEvent.PRE_RESEARCH_FAILED);
    expect(failureEventForState(InquiryState.ENRICHMENT)).toBe(WorkflowEvent.ENRICHMENT_FAILED);
    expect(failureEventForState(InquiryState.BROAD_RESEARCH)).toBe(WorkflowEvent.BROAD_RESEARCH_FAILED);
    expect(failureEventForState(InquiryState.FUNNEL)).toBe(WorkflowEvent.FUNNEL_FAILED);
    expect(failureEventForState(InquiryState.OUTREACH)).toBe(WorkflowEvent.OUTREACH_STALLED);
    expect(failureEventForState(InquiryState.REPORT_GENERATION)).toBe(WorkflowEvent.REPORT_FAILED);
  });

  it('returns null for non-processing / terminal states (nothing to recover)', () => {
    expect(failureEventForState(InquiryState.RECEIVED)).toBeNull();
    expect(failureEventForState(InquiryState.QUESTIONNAIRE_SENT)).toBeNull();
    expect(failureEventForState(InquiryState.REPORT_DELIVERED)).toBeNull();
    expect(failureEventForState(InquiryState.CANCELLED)).toBeNull();
  });
});

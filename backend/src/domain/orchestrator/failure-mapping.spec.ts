import { ReportState, WorkflowEvent, failureEventForState } from '@inqi/shared';

describe('failureEventForState', () => {
  it('maps each processing state to its failure/stall event', () => {
    expect(failureEventForState(ReportState.PRE_RESEARCH)).toBe(WorkflowEvent.PRE_RESEARCH_FAILED);
    expect(failureEventForState(ReportState.ENRICHMENT)).toBe(WorkflowEvent.ENRICHMENT_FAILED);
    expect(failureEventForState(ReportState.BROAD_RESEARCH)).toBe(WorkflowEvent.BROAD_RESEARCH_FAILED);
    expect(failureEventForState(ReportState.FUNNEL)).toBe(WorkflowEvent.FUNNEL_FAILED);
    expect(failureEventForState(ReportState.OUTREACH)).toBe(WorkflowEvent.OUTREACH_STALLED);
    expect(failureEventForState(ReportState.REPORT_GENERATION)).toBe(WorkflowEvent.REPORT_FAILED);
  });

  it('returns null for non-processing / terminal states (nothing to recover)', () => {
    expect(failureEventForState(ReportState.RECEIVED)).toBeNull();
    expect(failureEventForState(ReportState.QUESTIONNAIRE_SENT)).toBeNull();
    expect(failureEventForState(ReportState.REPORT_DELIVERED)).toBeNull();
    expect(failureEventForState(ReportState.CANCELLED)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { InquiryState } from '@inqi/shared';
import { Route } from './routes';
import { Stage, stageForInquiryState, stageIndex, isFailedState, isLiveStage, statusBadge, routeForStage, STAGE_ORDER } from './stages';

describe('stageForInquiryState', () => {
  it('maps internal states to the 6 customer stages', () => {
    expect(stageForInquiryState(InquiryState.RECEIVED)).toBe(Stage.Preparing);
    expect(stageForInquiryState(InquiryState.QUESTIONNAIRE_SENT)).toBe(Stage.Questionnaire);
    expect(stageForInquiryState(InquiryState.OUTREACH)).toBe(Stage.Researching);
    expect(stageForInquiryState(InquiryState.REPORT_DELIVERED)).toBe(Stage.Ready);
  });
  it('has 6 ordered stages and Ready is last', () => {
    expect(STAGE_ORDER).toHaveLength(6);
    expect(stageIndex(Stage.Ready)).toBe(5);
  });
});

describe('failed + live stage flags', () => {
  it('flags terminal-bad states as failed', () => {
    expect(isFailedState(InquiryState.CANCELLED)).toBe(true);
    expect(isFailedState(InquiryState.REPORT_DELIVERED)).toBe(false);
  });
  it('pulses on preparing/researching only', () => {
    expect(isLiveStage(Stage.Researching)).toBe(true);
    expect(isLiveStage(Stage.Ready)).toBe(false);
  });
});

describe('statusBadge', () => {
  it('labels ready, needs-you, and declined distinctly', () => {
    expect(statusBadge(InquiryState.REPORT_DELIVERED).label).toBe('Ready');
    expect(statusBadge(InquiryState.QUESTIONNAIRE_SENT).label).toBe('Needs you');
    expect(statusBadge(InquiryState.DENIED).label).toBe('Declined');
  });
});

describe('routeForStage', () => {
  it('routes ready/researching to the live report', () => {
    expect(routeForStage({ stage: Stage.Ready, inquiryId: 'i1' })).toEqual({ route: Route.Inquiry, params: { id: 'i1' } });
  });
  it('routes partially-ready to the freemium teaser', () => {
    expect(routeForStage({ stage: Stage.PartiallyReady, inquiryId: 'i1' })).toEqual({ route: Route.Freemium, params: { id: 'i1' } });
  });
  it('routes draft to new inquiry', () => {
    expect(routeForStage({ stage: Stage.Draft, inquiryId: 'i1' }).route).toBe(Route.NewInquiry);
  });
});

import { describe, it, expect } from 'vitest';
import { ReportState } from '@inqi/shared';
import { Route } from './routes';
import { Stage, stageForReportState, stageIndex, isFailedState, isLiveStage, statusBadge, routeForStage, STAGE_ORDER } from './stages';

describe('stageForReportState', () => {
  it('maps internal states to the 6 customer stages', () => {
    expect(stageForReportState(ReportState.RECEIVED)).toBe(Stage.Draft);
    expect(stageForReportState(ReportState.PRE_RESEARCH)).toBe(Stage.Preparing);
    expect(stageForReportState(ReportState.QUESTIONNAIRE_SENT)).toBe(Stage.Questionnaire);
    expect(stageForReportState(ReportState.OUTREACH)).toBe(Stage.Researching);
    expect(stageForReportState(ReportState.REPORT_DELIVERED)).toBe(Stage.Ready);
  });
  it('has 7 ordered stages and Ready is last', () => {
    expect(STAGE_ORDER).toHaveLength(7);
    expect(stageIndex(Stage.Ready)).toBe(6);
  });
});

describe('failed + live stage flags', () => {
  it('flags terminal-bad states as failed', () => {
    expect(isFailedState(ReportState.CANCELLED)).toBe(true);
    expect(isFailedState(ReportState.REPORT_DELIVERED)).toBe(false);
  });
  it('pulses on preparing/researching only', () => {
    expect(isLiveStage(Stage.Researching)).toBe(true);
    expect(isLiveStage(Stage.Ready)).toBe(false);
  });
});

describe('statusBadge', () => {
  it('labels ready, needs-you, and declined distinctly', () => {
    expect(statusBadge(ReportState.REPORT_DELIVERED).label).toBe('Ready');
    expect(statusBadge(ReportState.QUESTIONNAIRE_SENT).label).toBe('Needs you');
    expect(statusBadge(ReportState.DENIED).label).toBe('Declined');
  });
});

describe('routeForStage', () => {
  it('routes ready/researching to the live report', () => {
    expect(routeForStage({ stage: Stage.Ready, reportId: 'i1' })).toEqual({ route: Route.Report, params: { id: 'i1' } });
  });
  it('routes partially-ready to the live report (freemium teaser retired)', () => {
    expect(routeForStage({ stage: Stage.PartiallyReady, reportId: 'i1' })).toEqual({ route: Route.Report, params: { id: 'i1' } });
  });
  it('routes draft to new report', () => {
    expect(routeForStage({ stage: Stage.Draft, reportId: 'i1' }).route).toBe(Route.NewReport);
  });
});

import { describe, it, expect } from 'vitest';
import { ReportState, ReportStage, PARTIAL_READY_MIN, READY_MIN } from '@inqi/shared';
import { deriveStage, stageForReport, stageBadge } from './stages';

describe('deriveStage (HP-23)', () => {
  it('projects workflow state when below the partial-ready threshold', () => {
    expect(deriveStage({ state: ReportState.RECEIVED, qualifiedCount: 0 })).toBe(ReportStage.Draft);
    expect(deriveStage({ state: ReportState.PRE_RESEARCH, qualifiedCount: 0 })).toBe(ReportStage.Preparing);
    expect(deriveStage({ state: ReportState.QUESTIONNAIRE_SENT, qualifiedCount: 0 })).toBe(ReportStage.Questionnaire);
    expect(deriveStage({ state: ReportState.OUTREACH, qualifiedCount: 1 })).toBe(ReportStage.Researching);
  });

  it('crosses to Partially ready at the threshold and Finalizing at READY_MIN (Ready needs delivery)', () => {
    expect(deriveStage({ state: ReportState.OUTREACH, qualifiedCount: PARTIAL_READY_MIN })).toBe(ReportStage.PartiallyReady);
    expect(deriveStage({ state: ReportState.OUTREACH, qualifiedCount: PARTIAL_READY_MIN - 1 })).toBe(ReportStage.Researching);
    expect(deriveStage({ state: ReportState.OUTREACH, qualifiedCount: READY_MIN })).toBe(ReportStage.Finalizing); // target met, not yet delivered
    expect(deriveStage({ state: ReportState.OUTREACH, qualifiedCount: READY_MIN - 1 })).toBe(ReportStage.PartiallyReady);
  });

  it('a delivered report is always Ready, even below READY_MIN', () => {
    expect(deriveStage({ state: ReportState.REPORT_DELIVERED, qualifiedCount: 1 })).toBe(ReportStage.Ready);
  });

  it('thresholds are config-overridable', () => {
    expect(deriveStage({ state: ReportState.OUTREACH, qualifiedCount: 3, thresholds: { partialReadyMin: 1, readyMin: 3 } })).toBe(ReportStage.Finalizing);
  });

  it('stageForReport trusts the backend stage over re-deriving', () => {
    expect(stageForReport({ state: ReportState.OUTREACH, stage: ReportStage.Ready, qualifiedCount: 0 })).toBe(ReportStage.Ready);
    expect(stageForReport({ state: ReportState.OUTREACH, qualifiedCount: 2 })).toBe(ReportStage.PartiallyReady);
  });

  it('stageBadge follows the stage on the happy path; terminal/hold states win', () => {
    expect(stageBadge({ stage: ReportStage.PartiallyReady, state: ReportState.OUTREACH }).label).toBe('Partially ready');
    expect(stageBadge({ stage: ReportStage.Researching, state: ReportState.ON_HOLD }).label).toBe('On hold');
    expect(stageBadge({ stage: ReportStage.Researching, state: ReportState.CANCELLED }).label).toBe('Cancelled');
  });
});

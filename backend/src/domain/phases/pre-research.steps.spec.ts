import { PreResearchEvent, PreResearchState, ReviewStatus } from '@inqi/shared';
import { ComplianceBlockedError } from '../../common/errors';
import { PreResearchSteps } from './pre-research.steps';
import { PhaseStepRegistry, StepCtx } from './phase-step.tokens';

const REPORT = { id: 'r1', rawRequest: 'a weekly tennis coach near Porto' };

function build({ review, verdict, createThrows }: {
  review?: { status: string; reason?: string; categories?: string[]; score?: number };
  verdict?: unknown | Error;
  createThrows?: Error;
} = {}) {
  const registry = new PhaseStepRegistry();
  const db = { report: { update: jest.fn() }, subject: { findUnique: jest.fn().mockResolvedValue(null) } };
  const ai = {
    isConfigured: () => verdict !== undefined,
    structured: verdict instanceof Error ? jest.fn().mockRejectedValue(verdict) : jest.fn().mockResolvedValue(verdict),
  };
  const compliance = { score: jest.fn().mockResolvedValue(review ?? { status: ReviewStatus.Passed, categories: [], score: 0 }) };
  const subjects = { createFromReport: jest.fn() };
  const questionnaire = { createForReport: createThrows ? jest.fn().mockRejectedValue(createThrows) : jest.fn().mockResolvedValue('token') };
  const questionnaireGen = { generate: jest.fn().mockResolvedValue([{ id: 'q1', type: 'select', prompt: 'when?', options: ['am', 'pm'] }]) };
  new PreResearchSteps(registry, db as never, ai as never, compliance as never, subjects as never, questionnaire as never, questionnaireGen as never);
  const ctx = (state: string, data: Record<string, unknown> = {}): StepCtx => ({
    run: { id: 'run1', key: 'pre_research', state, data, reportId: 'r1', inquiryId: null } as never,
    report: REPORT as never, inquiry: null, log: jest.fn(),
  });
  const step = (state: string, data?: Record<string, unknown>) => registry.find({ key: 'pre_research', state })!.execute(ctx(state, data));
  return { step, db, subjects, questionnaire };
}

describe('pre_research step handlers', () => {
  it('COMPLIANCE_GATE: a blocked prompt writes denyReason and returns GATE_BLOCKED', async () => {
    const { step, db } = build({ review: { status: ReviewStatus.Blocked, reason: 'weapons', categories: ['illegal'], score: 0.9 } });
    const out = await step(PreResearchState.COMPLIANCE_GATE);
    expect(out.event).toBe(PreResearchEvent.GATE_BLOCKED);
    expect(db.report.update).toHaveBeenCalledWith(expect.objectContaining({ data: { denyReason: expect.stringContaining('request_compliance') } }));
  });

  it('FEASIBILITY: a deny verdict writes denyReason; an eligible one carries the enriched subject', async () => {
    const deny = build({ verdict: { decision: 'deny', reason: 'not feasible', riskTags: [] } });
    expect((await deny.step(PreResearchState.FEASIBILITY)).event).toBe(PreResearchEvent.FEASIBILITY_DENY);
    expect(deny.db.report.update).toHaveBeenCalled();

    const ok = build({ verdict: { decision: 'eligible', subject: { title: 'Tennis coach', summary: 's' } } });
    const out = await ok.step(PreResearchState.FEASIBILITY);
    expect(out.event).toBe(PreResearchEvent.FEASIBILITY_OK);
    expect(out.dataPatch).toEqual({ enriched: { title: 'Tennis coach', summary: 's' } });
  });

  it('FEASIBILITY fails OPEN: a model failure must not block a legitimate report', async () => {
    const { step } = build({ verdict: new Error('model down') });
    expect((await step(PreResearchState.FEASIBILITY)).event).toBe(PreResearchEvent.FEASIBILITY_OK);
  });

  it('SUBJECT is idempotent: an existing subject row is not recreated on a step retry', async () => {
    const { step, db, subjects } = build();
    db.subject.findUnique.mockResolvedValue({ id: 's1' });
    expect((await step(PreResearchState.SUBJECT)).event).toBe(PreResearchEvent.SUBJECT_CREATED);
    expect(subjects.createFromReport).not.toHaveBeenCalled();
  });

  it('QUESTIONNAIRE_GATE: a ComplianceBlockedError denies; other errors bubble to the step-retry path', async () => {
    const blocked = build({ createThrows: new ComplianceBlockedError({ message: 'blocked', details: { reason: 'unsafe' } }) });
    const out = await blocked.step(PreResearchState.QUESTIONNAIRE_GATE, { questions: [] });
    expect(out.event).toBe(PreResearchEvent.QUESTIONNAIRE_BLOCKED);

    const broken = build({ createThrows: new Error('db down') });
    await expect(broken.step(PreResearchState.QUESTIONNAIRE_GATE, { questions: [] })).rejects.toThrow('db down');
  });
});

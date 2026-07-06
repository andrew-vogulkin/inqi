import { ReviewStatus, WorkflowEvent } from '@inqi/shared';
import { ComplianceBlockedError } from '../../common/errors';
import { QuestionnaireService } from './questionnaire.service';

/** The answers-compliance gate (customer free text): blocked answers DENY the report. */
function svcWith({ review }: { review: { status: ReviewStatus; score?: number; categories?: string[]; reason?: string } }) {
  const q = { token: 'tok', reportId: 'r1', expiresAt: new Date(Date.now() + 3600_000) };
  const questionnaires = {
    findByToken: jest.fn().mockResolvedValue(q),
    reportOwner: jest.fn().mockResolvedValue({ customerId: 'c1', customerEmail: 'c@x.io' }),
    update: jest.fn().mockResolvedValue({}),
    denyReport: jest.fn().mockResolvedValue({}),
  };
  const wf = { advance: jest.fn().mockResolvedValue(undefined) };
  const compliance = { score: jest.fn().mockResolvedValue({ score: 0, categories: [], reason: '', ...review }) };
  const svc = new QuestionnaireService(questionnaires as never, wf as never, {} as never, compliance as never);
  return { svc, questionnaires, wf, compliance };
}

const viewer = { sub: 'c1', email: 'c@x.io', role: 'customer' };

describe('QuestionnaireService.submit — answers compliance gate', () => {
  it('passed answers advance the pipeline (QUESTIONNAIRE_FILLED) and record the review', async () => {
    const { svc, wf, questionnaires } = svcWith({ review: { status: ReviewStatus.Passed } });
    await svc.submit({ token: 'tok', answers: { confirmedSubject: true, answers: { budget: '300-500' } }, viewer });
    expect(wf.advance).toHaveBeenCalledWith({ reportId: 'r1', event: WorkflowEvent.QUESTIONNAIRE_FILLED });
    expect(questionnaires.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewStatus: ReviewStatus.Passed }),
    }));
    expect(questionnaires.denyReport).not.toHaveBeenCalled();
  });

  it('BLOCKED answers deny the report, advance QUESTIONNAIRE_DENIED and throw 422 — never QUESTIONNAIRE_FILLED', async () => {
    const { svc, wf, questionnaires, compliance } = svcWith({ review: { status: ReviewStatus.Blocked, reason: 'illegal request', categories: ['illegal_goods'] } });
    await expect(
      svc.submit({ token: 'tok', answers: { confirmedSubject: true, answers: { what: 'something the gate rejects' } }, viewer }),
    ).rejects.toThrow(ComplianceBlockedError);
    expect(compliance.score).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('something the gate rejects') }));
    expect(questionnaires.denyReport).toHaveBeenCalledWith({ reportId: 'r1', reason: expect.stringContaining('illegal request') });
    expect(wf.advance).toHaveBeenCalledWith({ reportId: 'r1', event: WorkflowEvent.QUESTIONNAIRE_DENIED });
    expect(wf.advance).not.toHaveBeenCalledWith(expect.objectContaining({ event: WorkflowEvent.QUESTIONNAIRE_FILLED }));
    // The blocked answers are still persisted (audit) with their verdict.
    expect(questionnaires.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewStatus: ReviewStatus.Blocked }),
    }));
  });

  it('empty answers skip the scorer entirely', async () => {
    const { svc, wf, compliance } = svcWith({ review: { status: ReviewStatus.Passed } });
    await svc.submit({ token: 'tok', answers: { confirmedSubject: true, answers: {} }, viewer });
    expect(compliance.score).not.toHaveBeenCalled();
    expect(wf.advance).toHaveBeenCalledWith({ reportId: 'r1', event: WorkflowEvent.QUESTIONNAIRE_FILLED });
  });
});

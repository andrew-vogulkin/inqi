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
  const svc = new QuestionnaireService(questionnaires as never, wf as never, {} as never /* config */, {} as never /* generator */, { recordAction: jest.fn() } as never /* usage */, compliance as never, { send: jest.fn() } as never /* mail */);
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

/** HP-27: an inbound to a questionnaire reply address must come FROM the report owner. */
function svcForEmailReply({ confirmed = false, ownerEmail = 'owner@x.io', replyAddress = 'tok@reply.io' } = {}) {
  const q = { token: 'tok', reportId: 'r1', confirmed, replyAddress, questions: [{ id: 'a', type: 'select', prompt: '?', options: ['x', 'Decide for me'] }] };
  const questionnaires = {
    findByReplyAddress: jest.fn().mockResolvedValue(q),
    reportDispatch: jest.fn().mockResolvedValue({ origin: 'email', customerEmail: ownerEmail }),
    findByReport: jest.fn().mockResolvedValue(q),
    update: jest.fn().mockResolvedValue({}),
    denyReport: jest.fn().mockResolvedValue({}),
  };
  const wf = { advance: jest.fn().mockResolvedValue(undefined) };
  const generator = { parseReply: jest.fn().mockResolvedValue({ answers: { a: 'x' }, confirmedSubject: true }) };
  const compliance = { score: jest.fn().mockResolvedValue({ status: ReviewStatus.Passed, score: 0, categories: [], reason: '' }) };
  const svc = new QuestionnaireService(questionnaires as never, wf as never, {} as never, generator as never, { recordAction: jest.fn() } as never, compliance as never, { send: jest.fn() } as never);
  return { svc, questionnaires, wf, generator };
}

describe('QuestionnaireService.handleEmailReply — sender authorization (HP-27)', () => {
  it('IGNORES a reply from a non-owner address (leaked reply address alone is not enough)', async () => {
    const { svc, wf, generator } = svcForEmailReply({ ownerEmail: 'owner@x.io' });
    const r = await svc.handleEmailReply({ toAddr: 'tok@reply.io', fromAddr: 'attacker@evil.com', body: 'my answers' });
    expect(r).toEqual({ handled: true, reportId: 'r1', authorized: false });
    expect(generator.parseReply).not.toHaveBeenCalled();
    expect(wf.advance).not.toHaveBeenCalled(); // the report is NOT advanced
  });

  it('accepts a reply from the owner (case-insensitive) and settles the report', async () => {
    const { svc, wf, generator } = svcForEmailReply({ ownerEmail: 'owner@x.io' });
    const r = await svc.handleEmailReply({ toAddr: 'tok@reply.io', fromAddr: 'Owner@X.io', body: 'x, go ahead' });
    expect(r).toEqual({ handled: true, reportId: 'r1', authorized: true });
    expect(generator.parseReply).toHaveBeenCalled();
    expect(wf.advance).toHaveBeenCalledWith({ reportId: 'r1', event: WorkflowEvent.QUESTIONNAIRE_FILLED });
  });

  it('IGNORES a reply with no From address', async () => {
    const { svc, wf } = svcForEmailReply();
    const r = await svc.handleEmailReply({ toAddr: 'tok@reply.io', fromAddr: undefined, body: 'x' });
    expect(r.authorized).toBe(false);
    expect(wf.advance).not.toHaveBeenCalled();
  });

  it('a non-matching reply address is not a questionnaire reply (falls through)', async () => {
    const { svc, questionnaires } = svcForEmailReply();
    questionnaires.findByReplyAddress.mockResolvedValueOnce(null);
    expect(await svc.handleEmailReply({ toAddr: 'nope@reply.io', fromAddr: 'owner@x.io', body: 'x' })).toEqual({ handled: false });
  });
});

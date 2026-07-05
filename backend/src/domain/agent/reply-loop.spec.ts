import { ChatRole } from '../../infra/ai/ai.tokens';
import { InquiryStatus, QueueJob } from '@inqi/shared';
import { AgentService } from './agent.service';

/**
 * The reply loop as a 2-element decision:
 *  1. EVALUATE — thread sufficient for the chain target (cost estimate + timeline)?
 *     yes → the source settles as usual (qualify with the extracted offer);
 *  2. ANSWER — no → follow-up answering the provider's questions by priority
 *     (original prompt > questionnaire > imagination), then re-ask for the target.
 */
function svcWith({ chain, aiReplies }: { chain: { role: ChatRole; content: string }[]; aiReplies: Record<string, unknown>[] }) {
  const prisma = { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) };
  const agents = {
    findInquiry: jest.fn().mockResolvedValue({ id: 's1', status: InquiryStatus.Contacted, epicId: 'e1', name: 'Acme' }),
    updateInquiry: jest.fn().mockResolvedValue({}),
    findFinding: jest.fn().mockResolvedValue(null),
    createFinding: jest.fn().mockResolvedValue({}),
    updateFinding: jest.fn().mockResolvedValue({}),
    findReportState: jest.fn().mockResolvedValue({ state: 'OUTREACH' }),
    findReportScope: jest.fn().mockResolvedValue({
      rawRequest: 'Dog grooming salon for a golden retriever, monthly visits, Munich',
      questionnaire: { questions: [{ id: 'budget', prompt: 'Budget per visit?' }], answers: { budget: 'Under €40' }, confirmed: true },
    }),
  };
  const boss = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const outbox = { emit: jest.fn().mockResolvedValue(undefined) };
  const outreach = {
    buildChain: jest.fn().mockResolvedValue(chain),
    sendFollowup: jest.fn().mockResolvedValue(undefined),
  };
  const sources = {
    findEmailThread: jest.fn().mockResolvedValue({ id: 'src1' }),
    updateThreadState: jest.fn().mockResolvedValue({}),
  };
  const reportContext = { buildAgentContext: jest.fn().mockResolvedValue({ text: 'CTX', estTokens: 1, truncated: false }) };
  const usage = { recordAction: jest.fn().mockResolvedValue(undefined) };
  const ai = { structured: jest.fn() };
  for (const r of aiReplies) ai.structured.mockResolvedValueOnce(r);

  const svc = new AgentService(
    prisma as never, agents as never, boss as never, outbox as never, {} as never /* activity */,
    outreach as never, sources as never, reportContext as never, usage as never, ai as never,
  );
  return { svc, agents, boss, outreach, ai };
}

const CHAIN = [
  { role: ChatRole.Assistant, content: 'Subject: Inquiry\nCould you quote?' },
  { role: ChatRole.User, content: 'Subject: Re\nWhat is the dog\'s weight?' },
];
const job = { reportId: 'r1', inquiryId: 's1', sourceId: 'src1' };

describe('AgentService reply loop — evaluate then answer', () => {
  it('a sufficient thread settles as usual: ONE model call, qualified with the extracted offer', async () => {
    const { svc, agents, ai, outreach } = svcWith({
      chain: CHAIN,
      aiReplies: [{ sufficient: true, declined: false, price: 65, currency: 'EUR', availability: 'weekday mornings', leadTime: '1 week', reason: 'quoted' }],
    });
    await svc['processReply'](job);
    expect(ai.structured).toHaveBeenCalledTimes(1); // no ANSWER call when the target is met
    expect(outreach.sendFollowup).not.toHaveBeenCalled();
    expect(agents.updateInquiry).toHaveBeenCalledWith(expect.objectContaining({
      id: 's1',
      data: expect.objectContaining({ status: InquiryStatus.Qualified, result: { price: 65, currency: 'EUR', availability: 'weekday mornings', leadTime: '1 week' } }),
    }));
  });

  it('an insufficient thread triggers the ANSWER element: follow-up drafted by priority, audited, sent — no settle', async () => {
    const { svc, agents, ai, outreach, boss } = svcWith({
      chain: CHAIN,
      aiReplies: [
        { sufficient: false, declined: false, price: null, currency: null, availability: null, leadTime: null, reason: 'asked for weight' },
        { body: 'He is a typical adult Golden of about 32 kg. Could you share the cost estimate and timeline?', answeredFrom: ['imagination'] },
        { movesForward: true, onTopic: true, issues: [] },
      ],
    });
    await svc['processReply'](job);
    expect(ai.structured).toHaveBeenCalledTimes(3); // evaluate + answer + draft audit
    // The ANSWER call carries the priority sources: raw prompt first, questionnaire second.
    const answerCall = ai.structured.mock.calls[1][0] as { user: string };
    expect(answerCall.user).toContain('# PRIORITY 1 — original search prompt');
    expect(answerCall.user).toContain('Dog grooming salon for a golden retriever');
    expect(answerCall.user).toContain('# PRIORITY 2 — confirmed questionnaire');
    expect(answerCall.user).toContain('Budget per visit?: Under €40');
    // The audit call sees the draft under review.
    const checkCall = ai.structured.mock.calls[2][0] as { user: string };
    expect(checkCall.user).toContain('# DRAFT under review');
    expect(checkCall.user).toContain('32 kg');
    expect(outreach.sendFollowup).toHaveBeenCalledWith(expect.objectContaining({ inquiryId: 's1', sourceId: 'src1', body: expect.stringContaining('32 kg') }));
    // Still negotiating — no settlement, no reactor signal.
    expect(boss.enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ job: QueueJob.InquirySettled }));
    expect(agents.updateInquiry).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: InquiryStatus.Qualified }) }));
  });

  it('a draft failing the audit is redrafted with the issues fed back; the passing redraft ships', async () => {
    const { svc, ai, outreach } = svcWith({
      chain: CHAIN,
      aiReplies: [
        { sufficient: false, declined: false, price: null, currency: null, availability: null, leadTime: null, reason: 'asked for weight' },
        { body: 'We need grooming within 3 km of Munich and many other requirements.', answeredFrom: ['questionnaire'] },
        { movesForward: false, onTopic: false, issues: ['does not answer the weight question', 'volunteers an unprompted requirements recap'] },
        { body: 'About 32 kg. Could you now share the cost estimate and the timeline?', answeredFrom: ['imagination'] },
        { movesForward: true, onTopic: true, issues: [] },
      ],
    });
    await svc['processReply'](job);
    expect(ai.structured).toHaveBeenCalledTimes(5); // evaluate + (answer+audit) ×2
    const redraftCall = ai.structured.mock.calls[3][0] as { user: string };
    expect(redraftCall.user).toContain('# Reviewer issues with your previous draft');
    expect(redraftCall.user).toContain('does not answer the weight question');
    expect(outreach.sendFollowup).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('About 32 kg') }));
  });

  it('when every draft attempt fails the audit, the safe canned follow-up ships (no draft)', async () => {
    const failedCheck = { movesForward: false, onTopic: true, issues: ['dodges the question'] };
    const { svc, ai, outreach } = svcWith({
      chain: CHAIN,
      aiReplies: [
        { sufficient: false, declined: false, price: null, currency: null, availability: null, leadTime: null, reason: 'asked for weight' },
        { body: 'bad draft 1', answeredFrom: [] }, failedCheck,
        { body: 'bad draft 2', answeredFrom: [] }, failedCheck,
      ],
    });
    await svc['processReply'](job);
    expect(ai.structured).toHaveBeenCalledTimes(5);
    // No body → EmailChannelService.sendFollowup falls back to the canned target re-ask.
    expect(outreach.sendFollowup).toHaveBeenCalledWith(expect.objectContaining({ inquiryId: 's1', body: undefined }));
  });

  it('a declining provider disqualifies the inquiry with the reason persisted', async () => {
    const { svc, agents } = svcWith({
      chain: CHAIN,
      aiReplies: [{ sufficient: false, declined: true, price: null, currency: null, availability: null, leadTime: null, reason: 'fully booked this year' }],
    });
    await svc['processReply'](job);
    expect(agents.updateInquiry).toHaveBeenCalledWith(expect.objectContaining({
      id: 's1',
      data: expect.objectContaining({ status: InquiryStatus.Failed, result: { disqualified: 'fully booked this year' } }),
    }));
  });

  it('the thread cap settles an insufficient chain with what was extracted instead of looping forever', async () => {
    const cappedChain = [
      ...Array.from({ length: 4 }, (_, i) => ({ role: ChatRole.Assistant, content: `Subject: Re\nfollow-up ${i}` })),
      { role: ChatRole.User, content: 'Subject: Re\nstill vague' },
    ];
    const { svc, agents, ai, outreach } = svcWith({
      chain: cappedChain,
      aiReplies: [{ sufficient: false, declined: false, price: 60, currency: 'EUR', availability: null, leadTime: null, reason: 'price mentioned but no timeline' }],
    });
    await svc['processReply'](job);
    expect(ai.structured).toHaveBeenCalledTimes(1); // never reaches the ANSWER element
    expect(outreach.sendFollowup).not.toHaveBeenCalled();
    expect(agents.updateInquiry).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: InquiryStatus.Qualified, result: expect.objectContaining({ price: 60, currency: 'EUR' }) }),
    }));
  });

  it('a null extraction never erases previously confirmed offer fields on the option finding', async () => {
    const { svc, agents } = svcWith({
      chain: CHAIN,
      aiReplies: [{ sufficient: true, declined: false, price: null, currency: null, availability: 'can accommodate', leadTime: null, reason: 'vague confirmation' }],
    });
    agents.findFinding.mockResolvedValue({ id: 'f1', data: { subjectProvider: 'Acme', price: 120, currency: 'EUR', leadTime: 'one week' } });
    await svc['processReply'](job);
    expect(agents.updateFinding).toHaveBeenCalledWith(expect.objectContaining({
      id: 'f1',
      // price/currency/leadTime survive; only the newly evidenced availability lands.
      data: expect.objectContaining({ price: 120, currency: 'EUR', leadTime: 'one week', availability: 'can accommodate' }),
    }));
  });
});

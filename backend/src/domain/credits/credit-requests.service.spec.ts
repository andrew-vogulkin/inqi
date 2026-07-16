import { CreditsService } from './credits.service';

/** CreditsService with a stubbed repo + audit, for the credit-request flow. */
function make() {
  const repo = {
    createRequest: jest.fn().mockResolvedValue({ id: 'req1' }),
    listPendingRequests: jest.fn().mockResolvedValue([{ id: 'req1', amount: 5, note: null, createdAt: new Date(), customerId: 'c1', email: 'a@x.io', name: null }]),
    approveRequest: jest.fn().mockResolvedValue({ customerId: 'c1', email: 'a@x.io', amount: 5, balance: 15 }),
    rejectRequest: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const mail = { send: jest.fn().mockResolvedValue({ externalId: '<x>' }) };
  const config = { webBaseUrl: 'https://inqi.test' };
  const svc = new CreditsService(repo as never, {} as never, audit as never, config as never, mail as never);
  return { svc, repo, audit, mail };
}

describe('CreditsService — credit top-up requests', () => {
  it('files a request for a positive amount', async () => {
    const { svc, repo } = make();
    await expect(svc.requestTopUp({ customerId: 'c1', amount: 5, note: 'batch week' })).resolves.toEqual({ id: 'req1' });
    expect(repo.createRequest).toHaveBeenCalledWith({ customerId: 'c1', amount: 5, note: 'batch week' });
  });

  it('rejects a non-positive / non-integer requested amount before touching the repo', async () => {
    const { svc, repo } = make();
    await expect(svc.requestTopUp({ customerId: 'c1', amount: 0 })).rejects.toThrow();
    await expect(svc.requestTopUp({ customerId: 'c1', amount: 2.5 })).rejects.toThrow();
    expect(repo.createRequest).not.toHaveBeenCalled();
  });

  it('approve grants the requested credits, audits, and emails the customer', async () => {
    const { svc, repo, audit, mail } = make();
    const r = await svc.approveRequest({ requestId: 'req1', actorId: 'a1', actorEmail: 'ops@x.io' });
    expect(r).toMatchObject({ amount: 5, balance: 15, email: 'a@x.io' });
    expect(repo.approveRequest).toHaveBeenCalledWith({ requestId: 'req1', actorId: 'a1', actorEmail: 'ops@x.io', amount: undefined });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actor: 'ops@x.io', targetId: 'c1', data: expect.objectContaining({ requestId: 'req1', amount: 5, balance: 15 }) }));
    await new Promise((r) => setImmediate(r)); // the approval email is fired best-effort (not awaited)
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@x.io', subject: expect.stringContaining('+5') }));
  });

  it('approve passes the operator amount override through to the repo', async () => {
    const { svc, repo } = make();
    await svc.approveRequest({ requestId: 'req1', actorId: 'a1', actorEmail: 'ops@x.io', amount: 8 });
    expect(repo.approveRequest).toHaveBeenCalledWith({ requestId: 'req1', actorId: 'a1', actorEmail: 'ops@x.io', amount: 8 });
  });

  it('rejects a non-positive amount override before touching the repo', async () => {
    const { svc, repo } = make();
    await expect(svc.approveRequest({ requestId: 'req1', actorId: 'a1', actorEmail: 'ops@x.io', amount: 0 })).rejects.toThrow();
    expect(repo.approveRequest).not.toHaveBeenCalled();
  });

  it('reject closes the request without granting (no audit topup)', async () => {
    const { svc, repo, audit } = make();
    await svc.rejectRequest({ requestId: 'req1', actorId: 'a1', actorEmail: 'ops@x.io' });
    expect(repo.rejectRequest).toHaveBeenCalledWith({ requestId: 'req1', actorId: 'a1' });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

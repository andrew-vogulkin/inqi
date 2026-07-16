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
  const svc = new CreditsService(repo as never, {} as never, audit as never, {} as never);
  return { svc, repo, audit };
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

  it('approve grants the requested credits and writes an audit row', async () => {
    const { svc, repo, audit } = make();
    const r = await svc.approveRequest({ requestId: 'req1', actorId: 'a1', actorEmail: 'ops@x.io' });
    expect(r).toMatchObject({ amount: 5, balance: 15, email: 'a@x.io' });
    expect(repo.approveRequest).toHaveBeenCalledWith({ requestId: 'req1', actorId: 'a1', actorEmail: 'ops@x.io' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actor: 'ops@x.io', targetId: 'c1', data: expect.objectContaining({ requestId: 'req1', amount: 5, balance: 15 }) }));
  });

  it('reject closes the request without granting (no audit topup)', async () => {
    const { svc, repo, audit } = make();
    await svc.rejectRequest({ requestId: 'req1', actorId: 'a1', actorEmail: 'ops@x.io' });
    expect(repo.rejectRequest).toHaveBeenCalledWith({ requestId: 'req1', actorId: 'a1' });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

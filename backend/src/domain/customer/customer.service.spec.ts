import { AccountStatus, AuditAction, AuthRole } from '@inqi/shared';
import { DomainError } from '../../common/errors';
import { CustomerService } from './customer.service';

/** Build a service over stub repo + audit; expose the mocks for assertions (HP-25). */
function make() {
  const repo = {
    findById: jest.fn(),
    searchUsers: jest.fn(),
    reportCountsFor: jest.fn().mockResolvedValue({}),
    setSuspension: jest.fn(),
    isSuspended: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const svc = new CustomerService(repo as never, audit as never);
  return { svc, repo, audit };
}

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'c1', email: 'ada@x.io', name: 'Ada', role: AuthRole.Customer,
  createdAt: new Date('2026-07-01T09:00:00Z'), credits: 3, suspendedAt: null, ...over,
});

describe('CustomerService.suspend (HP-25)', () => {
  it('refuses to suspend your own account', async () => {
    const { svc, repo, audit } = make();
    await expect(svc.suspend({ id: 'me', actorId: 'me', actorEmail: 'op@x.io' })).rejects.toBeInstanceOf(DomainError);
    expect(repo.findById).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses to suspend another admin', async () => {
    const { svc, repo, audit } = make();
    repo.findById.mockResolvedValue(row({ id: 'c2', role: AuthRole.Admin }));
    await expect(svc.suspend({ id: 'c2', actorId: 'me', actorEmail: 'op@x.io' })).rejects.toBeInstanceOf(DomainError);
    expect(repo.setSuspension).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s a missing target', async () => {
    const { svc, repo } = make();
    repo.findById.mockResolvedValue(null);
    await expect(svc.suspend({ id: 'gone', actorId: 'me', actorEmail: 'op@x.io' })).rejects.toBeInstanceOf(DomainError);
  });

  it('suspends an active customer: stamps suspendedAt, audits, returns suspended view', async () => {
    const { svc, repo, audit } = make();
    repo.findById.mockResolvedValue(row());
    repo.setSuspension.mockResolvedValue(row({ suspendedAt: new Date('2026-07-12T00:00:00Z') }));
    repo.reportCountsFor.mockResolvedValue({ c1: 4 });
    const view = await svc.suspend({ id: 'c1', reason: 'spam', actorId: 'me', actorEmail: 'op@x.io' });
    expect(repo.setSuspension).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', reason: 'spam', byId: 'me', suspendedAt: expect.any(Date) }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.SuspendUser, targetId: 'c1', actor: 'op@x.io' }));
    expect(view.status).toBe(AccountStatus.Suspended);
    expect(view.reportCount).toBe(4);
  });

  it('is idempotent when already suspended (no re-stamp, no audit)', async () => {
    const { svc, repo, audit } = make();
    repo.findById.mockResolvedValue(row({ suspendedAt: new Date('2026-07-01T00:00:00Z') }));
    const view = await svc.suspend({ id: 'c1', actorId: 'me', actorEmail: 'op@x.io' });
    expect(repo.setSuspension).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(view.status).toBe(AccountStatus.Suspended);
  });
});

describe('CustomerService.reactivate (HP-25)', () => {
  it('clears the suspension + audits', async () => {
    const { svc, repo, audit } = make();
    repo.findById.mockResolvedValue(row({ suspendedAt: new Date('2026-07-01T00:00:00Z') }));
    repo.setSuspension.mockResolvedValue(row({ suspendedAt: null }));
    const view = await svc.reactivate({ id: 'c1', actorEmail: 'op@x.io' });
    expect(repo.setSuspension).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', suspendedAt: null, byId: null }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.ReactivateUser, targetId: 'c1' }));
    expect(view.status).toBe(AccountStatus.Active);
  });

  it('is idempotent for an already-active account', async () => {
    const { svc, repo, audit } = make();
    repo.findById.mockResolvedValue(row({ suspendedAt: null }));
    await svc.reactivate({ id: 'c1', actorEmail: 'op@x.io' });
    expect(repo.setSuspension).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('CustomerService.listUsers (HP-25)', () => {
  it('slices take+1, derives status, ISO dates, and returns the email cursor', async () => {
    const { svc, repo } = make();
    // limit 2 → repo returns 3 rows (take+1) → hasMore, nextCursor = 2nd row's email.
    repo.searchUsers.mockResolvedValue([
      row({ id: 'a', email: 'a@x.io' }),
      row({ id: 'b', email: 'b@x.io', suspendedAt: new Date('2026-07-02T00:00:00Z') }),
      row({ id: 'c', email: 'c@x.io' }),
    ]);
    repo.reportCountsFor.mockResolvedValue({ a: 1, b: 2 });
    const out = await svc.listUsers({ limit: 2 });
    expect(out.rows).toHaveLength(2);
    expect(out.nextCursor).toBe('b@x.io');
    expect(out.rows[0]).toMatchObject({ email: 'a@x.io', status: AccountStatus.Active, registeredAt: '2026-07-01T09:00:00.000Z', reportCount: 1 });
    expect(out.rows[1]).toMatchObject({ email: 'b@x.io', status: AccountStatus.Suspended, reportCount: 2 });
  });

  it('null cursor on the last page', async () => {
    const { svc, repo } = make();
    repo.searchUsers.mockResolvedValue([row({ id: 'a', email: 'a@x.io' })]);
    repo.reportCountsFor.mockResolvedValue({ a: 0 });
    const out = await svc.listUsers({ limit: 25 });
    expect(out.nextCursor).toBeNull();
  });
});

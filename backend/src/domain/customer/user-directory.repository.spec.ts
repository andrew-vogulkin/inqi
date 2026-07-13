import { AccountStatus } from '@inqi/shared';
import { CustomerRepository } from './customer.repository';

/** A repo over a stubbed prisma client; expose the query mocks (HP-25). */
function repoWith({ users = [], counts = {} }: { users?: unknown[]; counts?: Record<string, number> } = {}) {
  const findMany = jest.fn().mockResolvedValue(users);
  const count = jest.fn().mockImplementation(({ where }: { where: { OR: { customerId?: string }[] } }) => {
    const id = where.OR[0].customerId as string;
    return Promise.resolve(counts[id] ?? 0);
  });
  const findUnique = jest.fn();
  const update = jest.fn();
  const repo = new CustomerRepository({ customer: { findMany, findUnique, update }, report: { count } } as never);
  return { repo, findMany, count, findUnique, update };
}

describe('CustomerRepository.searchUsers (HP-25)', () => {
  it('orders by email ascending and fetches take+1', async () => {
    const { repo, findMany } = repoWith();
    await repo.searchUsers({ take: 25 });
    const arg = findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ email: 'asc' });
    expect(arg.take).toBe(26);
    expect(arg.cursor).toBeUndefined();
  });

  it('applies the email cursor with skip:1', async () => {
    const { repo, findMany } = repoWith();
    await repo.searchUsers({ take: 10, cursorEmail: 'bob@x.io' });
    const arg = findMany.mock.calls[0][0];
    expect(arg.cursor).toEqual({ email: 'bob@x.io' });
    expect(arg.skip).toBe(1);
  });

  it('narrows to suspended (suspendedAt not null) and matches q on email/name', async () => {
    const { repo, findMany } = repoWith();
    await repo.searchUsers({ take: 10, q: 'ada', status: AccountStatus.Suspended });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.AND).toEqual(expect.arrayContaining([
      { OR: [{ email: { contains: 'ada', mode: 'insensitive' } }, { name: { contains: 'ada', mode: 'insensitive' } }] },
      { suspendedAt: { not: null } },
    ]));
  });

  it('narrows to active (suspendedAt null)', async () => {
    const { repo, findMany } = repoWith();
    await repo.searchUsers({ take: 10, status: AccountStatus.Active });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.AND).toEqual([{ suspendedAt: null }]);
  });
});

describe('CustomerRepository.reportCountsFor (HP-25)', () => {
  it('counts by FK OR email, keyed by customer id', async () => {
    const { repo, count } = repoWith({ counts: { c1: 4, c2: 0 } });
    const out = await repo.reportCountsFor({ users: [{ id: 'c1', email: 'a@x.io' }, { id: 'c2', email: 'b@x.io' }] });
    expect(out).toEqual({ c1: 4, c2: 0 });
    expect(count.mock.calls[0][0].where.OR).toEqual([{ customerId: 'c1' }, { customerEmail: 'a@x.io' }]);
  });
});

describe('CustomerRepository.isSuspended (HP-25)', () => {
  it('is true when suspendedAt is set, false otherwise', async () => {
    const { repo, findUnique } = repoWith();
    findUnique.mockResolvedValueOnce({ suspendedAt: new Date() });
    expect(await repo.isSuspended({ id: 'c1' })).toBe(true);
    findUnique.mockResolvedValueOnce({ suspendedAt: null });
    expect(await repo.isSuspended({ id: 'c1' })).toBe(false);
    findUnique.mockResolvedValueOnce(null);
    expect(await repo.isSuspended({ id: 'gone' })).toBe(false);
  });
});

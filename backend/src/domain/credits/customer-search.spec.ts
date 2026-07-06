import { CreditsRepository } from './credits.repository';

function repoWith(rows: { id: string; name: string | null; email: string }[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const repo = new CreditsRepository({ customer: { findMany } } as never);
  return { repo, findMany };
}

describe('CreditsRepository.searchCustomers (HP-22)', () => {
  it('returns [] for an empty/whitespace query without hitting the DB', async () => {
    const { repo, findMany } = repoWith([]);
    expect(await repo.searchCustomers({ q: '   ' })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('matches name/email/id (case-insensitive), limits, and maps null name → ""', async () => {
    const { repo, findMany } = repoWith([{ id: 'c1', name: null, email: 'ada@x.io' }]);
    const out = await repo.searchCustomers({ q: 'ada' });
    expect(out).toEqual([{ id: 'c1', name: '', email: 'ada@x.io' }]);
    const arg = findMany.mock.calls[0][0];
    expect(arg.take).toBe(20);
    expect(arg.where.OR).toEqual(expect.arrayContaining([
      { email: { contains: 'ada', mode: 'insensitive' } },
      { name: { contains: 'ada', mode: 'insensitive' } },
      { id: 'ada' },
    ]));
  });
});

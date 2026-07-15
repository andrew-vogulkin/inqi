import { AuditActor, CreditKind } from '@inqi/shared';
import { CustomerRepository } from './customer.repository';

/** A repo over a stubbed prisma client that captures the upsert payload. */
function repoWith() {
  const upsert = jest.fn().mockResolvedValue({ id: 'c1' });
  const repo = new CustomerRepository({ customer: { upsert } } as never);
  return { repo, upsert };
}

describe('CustomerRepository.upsertByEmail — initial credit grant', () => {
  it('writes the balance AND a matching topup ledger row on create when initialCredits > 0', async () => {
    const { repo, upsert } = repoWith();
    await repo.upsertByEmail({ email: 'new@x.io', initialCredits: 10 });

    const { create } = upsert.mock.calls[0][0];
    expect(create.credits).toBe(10); // balance
    expect(create.ledger.create).toEqual({
      kind: CreditKind.Topup, amount: 10, reason: 'Initial welcome credits', actor: AuditActor.System,
    });
  });

  it('grants ONLY on insert — the update branch never touches credits (a returning user is not re-granted)', async () => {
    const { repo, upsert } = repoWith();
    await repo.upsertByEmail({ email: 'existing@x.io', initialCredits: 10 });
    const { update } = upsert.mock.calls[0][0];
    expect(update.credits).toBeUndefined();
    expect(update.ledger).toBeUndefined();
  });

  it('writes no balance and no ledger row when the grant is disabled (0 or omitted)', async () => {
    const { repo, upsert } = repoWith();
    await repo.upsertByEmail({ email: 'zero@x.io', initialCredits: 0 });
    const { create } = upsert.mock.calls[0][0];
    expect(create.credits).toBeUndefined(); // falls back to the schema default (0)
    expect(create.ledger).toBeUndefined();
  });
});

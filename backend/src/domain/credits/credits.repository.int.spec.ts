import { PrismaClient } from '@prisma/client';
import { CreditKind } from '@inqi/shared';
import { CreditsRepository } from './credits.repository';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { PaymentRequiredError } from '../../common/errors';
import { startTestDb, TestDb } from '../../test-support/db-harness';

/**
 * INTEGRATION — CreditsRepository against a real Postgres.
 *
 * The credit ledger is the money path, and its correctness rests on DB semantics
 * the unit suite mocks away: conditional decrements (`credits >= amount`), the
 * (reportId, kind) unique that makes unlock/settle idempotent, and every mutation
 * being atomic with the maintained `Customer.credits`. These assert the real thing.
 * Run: `pnpm test:int`.
 */
let db: TestDb;
let prisma: PrismaClient;
let repo: CreditsRepository;
let workflowVersionId: string;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  repo = new CreditsRepository(prisma as unknown as PrismaService);
  const wf = await prisma.workflowDefinition.create({ data: { key: 'report', version: 1, status: 'active' } });
  workflowVersionId = wf.id;
}, 180_000);

afterAll(async () => { await db?.stop(); });

beforeEach(async () => {
  await prisma.creditLedger.deleteMany();
  await prisma.reportSnapshot.deleteMany();
  await prisma.report.deleteMany();
  await prisma.customer.deleteMany();
});

let seq = 0;
async function mkCustomer(opts: { credits?: number; freeReportUsed?: boolean } = {}): Promise<string> {
  const c = await prisma.customer.create({
    data: { email: `c${seq++}@x.io`, credits: opts.credits ?? 0, freeReportUsed: opts.freeReportUsed ?? false },
  });
  return c.id;
}

async function mkReport(opts: { customerId?: string | null; freeReport?: boolean; options?: unknown[] }): Promise<string> {
  const r = await prisma.report.create({
    data: { customerEmail: 'r@x.io', customerId: opts.customerId ?? null, rawRequest: 'req', workflowVersionId, freeReport: opts.freeReport ?? false, state: 'REPORT_DELIVERED' },
  });
  if (opts.options) {
    await prisma.reportSnapshot.create({ data: { reportId: r.id, token: `tok-${r.id}`, summary: 's', options: opts.options as never, timeline: [] } });
  }
  return r.id;
}

const balanceOf = (id: string) => prisma.customer.findUniqueOrThrow({ where: { id }, select: { credits: true } }).then((c) => c.credits);
const ledgerCount = (where: object) => prisma.creditLedger.count({ where });

describe('CreditsRepository.claimFreeReport (real DB)', () => {
  it('flips freeReportUsed false→true exactly once (the free slot is single-use)', async () => {
    const id = await mkCustomer({ freeReportUsed: false });
    expect(await repo.claimFreeReport({ customerId: id })).toBe(true);
    expect(await repo.claimFreeReport({ customerId: id })).toBe(false); // already spent
    expect((await prisma.customer.findUniqueOrThrow({ where: { id } })).freeReportUsed).toBe(true);
  });
});

describe('CreditsRepository.chargeUnlock (real DB)', () => {
  it('charges 1 credit, appends an unlock row, returns the new balance', async () => {
    const id = await mkCustomer({ credits: 3 });
    const reportId = await mkReport({ customerId: id });
    const res = await repo.chargeUnlock({ customerId: id, reportId, actor: 'admin' });
    expect(res).toEqual({ charged: true, balance: 2 });
    expect(await balanceOf(id)).toBe(2);
    expect(await ledgerCount({ reportId, kind: CreditKind.Unlock })).toBe(1);
  });

  it('is idempotent per report — a second unlock does not double-charge', async () => {
    const id = await mkCustomer({ credits: 3 });
    const reportId = await mkReport({ customerId: id });
    await repo.chargeUnlock({ customerId: id, reportId, actor: 'admin' });
    const second = await repo.chargeUnlock({ customerId: id, reportId, actor: 'admin' });
    expect(second.charged).toBe(false);
    expect(await balanceOf(id)).toBe(2);                                  // still only charged once
    expect(await ledgerCount({ reportId, kind: CreditKind.Unlock })).toBe(1);
  });

  it('rejects with 402 and charges nothing when the balance is short', async () => {
    const id = await mkCustomer({ credits: 0 });
    const reportId = await mkReport({ customerId: id });
    await expect(repo.chargeUnlock({ customerId: id, reportId, actor: 'admin' })).rejects.toBeInstanceOf(PaymentRequiredError);
    expect(await balanceOf(id)).toBe(0);                                  // untouched
    expect(await ledgerCount({ reportId })).toBe(0);                      // no row written
  });
});

describe('CreditsRepository.topUp (real DB)', () => {
  it('increments the balance and appends a topup row atomically', async () => {
    const id = await mkCustomer({ credits: 5 });
    const { balance } = await repo.topUp({ customerId: id, amount: 10, note: 'grant', actor: 'admin' });
    expect(balance).toBe(15);
    expect(await balanceOf(id)).toBe(15);
    expect(await ledgerCount({ customerId: id, kind: CreditKind.Topup })).toBe(1);
  });
});

describe('CreditsRepository.settle — pay-on-delivery (real DB)', () => {
  it('charges the report cost on a delivered report that has options', async () => {
    const id = await mkCustomer({ credits: 5 });
    const reportId = await mkReport({ customerId: id, options: [{ name: 'A' }] });
    const res = await repo.settle({ reportId, action: 'charge', cost: 1, reason: 'charge' });
    expect(res.settled).toBe(true);
    expect(res.amount).toBe(1);
    expect(await balanceOf(id)).toBe(4);
    expect(await ledgerCount({ reportId, kind: CreditKind.Charge })).toBe(1);
  });

  it('never charges a free (freemium) report', async () => {
    const id = await mkCustomer({ credits: 5 });
    const reportId = await mkReport({ customerId: id, freeReport: true, options: [{ name: 'A' }] });
    const res = await repo.settle({ reportId, action: 'charge', cost: 1 });
    expect(res.settled).toBe(false);
    expect(await balanceOf(id)).toBe(5);
  });

  it('never charges a delivered report that produced zero options', async () => {
    const id = await mkCustomer({ credits: 5 });
    const reportId = await mkReport({ customerId: id, options: [] }); // delivered, but empty
    const res = await repo.settle({ reportId, action: 'charge', cost: 1 });
    expect(res.settled).toBe(false);
    expect(await balanceOf(id)).toBe(5);
  });

  it('is idempotent — a second charge settle is a no-op (one debit, one row)', async () => {
    const id = await mkCustomer({ credits: 5 });
    const reportId = await mkReport({ customerId: id, options: [{ name: 'A' }] });
    await repo.settle({ reportId, action: 'charge', cost: 1 });
    const again = await repo.settle({ reportId, action: 'charge', cost: 1 });
    expect(again.settled).toBe(false);
    expect(await balanceOf(id)).toBe(4);                                 // charged once
    expect(await ledgerCount({ reportId, kind: CreditKind.Charge })).toBe(1);
  });

  it('refund on a report with nothing held is a no-op (a non-delivered run costs nothing)', async () => {
    const id = await mkCustomer({ credits: 5 });
    const reportId = await mkReport({ customerId: id, options: [{ name: 'A' }] });
    const res = await repo.settle({ reportId, action: 'refund', cost: 1 });
    expect(res.settled).toBe(false);
    expect(await balanceOf(id)).toBe(5);
  });
});

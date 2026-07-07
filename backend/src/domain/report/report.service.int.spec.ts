import { PrismaClient } from '@prisma/client';
import { ReportService } from './report.service';
import { ReportRepository } from './report.repository';
import { CreditsRepository } from '../credits/credits.repository';
import { OutboxService } from '../../infra/events/outbox.service';
import { WorkflowEngine } from '../orchestrator/workflow-engine.service';
import { CreditsService } from '../credits/credits.service';
import { BossService } from '../../infra/queue/boss.service';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { PaymentRequiredError } from '../../common/errors';
import { startTestDb, TestDb } from '../../test-support/db-harness';

/**
 * INTEGRATION — ReportService.create credit-gating against a real Postgres.
 *
 * Submit is credits-first (HP-21): enough balance → a paid report; else the one
 * free slot; else 402. The behaviour that a mocked unit test cannot show is the
 * **transaction boundary** — a 402 must leave NO report row and NOT consume the
 * free slot (the whole createTx rolls back). Here the real balance read + free-slot
 * claim + row insert run in one real DB transaction. Run: `pnpm test:int`.
 */
let db: TestDb;
let prisma: PrismaClient;
let workflowVersionId: string;
let boss: { enqueue: jest.Mock };
let svc: ReportService;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  const wf = await prisma.workflowDefinition.create({ data: { key: 'report', version: 1, status: 'active' } });
  workflowVersionId = wf.id;

  const reports = new ReportRepository(prisma as unknown as PrismaService);
  const outbox = new OutboxService(prisma as unknown as PrismaService);
  const creditsRepo = new CreditsRepository(prisma as unknown as PrismaService);
  // Real balance + free-slot claim against the DB; only reportCost is fixed config.
  const credits = {
    reportCost: () => 1,
    balance: (a: { customerId: string; tx?: unknown }) => creditsRepo.balance(a as never),
    claimFreeReport: (a: { customerId: string; tx?: unknown }) => creditsRepo.claimFreeReport(a as never),
  } as unknown as CreditsService;
  // Model-adjacent deps stubbed: the version is pinned, and the queue kickoff is a
  // post-commit side-effect we assert on but don't execute.
  const wfEngine = { activeVersionId: async () => workflowVersionId, advance: async () => undefined } as unknown as WorkflowEngine;
  boss = { enqueue: jest.fn(async () => undefined) };

  svc = new ReportService(
    prisma as unknown as PrismaService, reports, wfEngine, outbox, credits, boss as unknown as BossService,
  );
}, 180_000);

afterAll(async () => { await db?.stop(); });

beforeEach(async () => {
  boss.enqueue.mockClear();
  await prisma.creditLedger.deleteMany();
  await prisma.reportSnapshot.deleteMany();
  await prisma.report.deleteMany();
  await prisma.customer.deleteMany();
});

let seq = 0;
async function mkCustomer(opts: { credits?: number; freeReportUsed?: boolean }) {
  return prisma.customer.create({ data: { email: `c${seq++}@x.io`, credits: opts.credits ?? 0, freeReportUsed: opts.freeReportUsed ?? false } });
}
const dto = { rawRequest: 'a padel coach in Lisbon' };

describe('ReportService.create — credit-gating (real DB)', () => {
  it('with enough credits: a paid report, the free slot is untouched', async () => {
    const cust = await mkCustomer({ credits: 5 });
    const report = await svc.create({ dto, viewer: { sub: cust.id, email: cust.email, role: 'customer' as never } });

    expect(report.freeReport).toBe(false);
    const persisted = await prisma.report.findUnique({ where: { id: report.id } });
    expect(persisted?.customerId).toBe(cust.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).freeReportUsed).toBe(false); // slot preserved
    expect(boss.enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ job: 'notify_admins_freemium' }));
  });

  it('with no credits + free slot: falls back to a freemium report and consumes the slot', async () => {
    const cust = await mkCustomer({ credits: 0, freeReportUsed: false });
    const report = await svc.create({ dto, viewer: { sub: cust.id, email: cust.email, role: 'customer' as never } });

    expect(report.freeReport).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).freeReportUsed).toBe(true); // slot spent
    expect(boss.enqueue).toHaveBeenCalledWith(expect.objectContaining({ job: 'notify_admins_freemium', data: { reportId: report.id } }));
  });

  it('with no credits + spent slot: 402, and the transaction rolls back (no report row)', async () => {
    const cust = await mkCustomer({ credits: 0, freeReportUsed: true });
    await expect(svc.create({ dto, viewer: { sub: cust.id, email: cust.email, role: 'customer' as never } }))
      .rejects.toBeInstanceOf(PaymentRequiredError);

    expect(await prisma.report.count()).toBe(0);       // createTx rolled back — no orphan row
    expect(boss.enqueue).not.toHaveBeenCalled();        // no post-commit kickoff
  });
});

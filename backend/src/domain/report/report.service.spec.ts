import { PaymentRequiredError } from '../../common/errors';
import { ReportService } from './report.service';

/** Credits-first intake (HP-21 revised) + pay-on-delivery: submit checks the balance, never holds it. */
function makeService({ balance, freeSlot }: { balance: number; freeSlot: boolean }) {
  const tx = {};
  const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const reports = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', rawRequest: data.rawRequest, ...data })),
    countByRefPrefix: jest.fn(async () => 2), // two refs minted today → the next is -03
  };
  const wf = { activeVersionId: jest.fn(async () => 'wfv1'), advance: jest.fn(async () => undefined) };
  const outbox = { emit: jest.fn(async () => undefined) };
  const credits = {
    reportCost: () => 1,
    balance: jest.fn(async () => balance),
    claimFreeReport: jest.fn(async () => freeSlot),
  };
  const boss = { enqueue: jest.fn(async () => undefined) };
  const svc = new ReportService(prisma as never, reports as never, wf as never, outbox as never, credits as never, boss as never);
  return { svc, credits, reports, boss };
}

const viewer = { sub: 'c1', email: 'a@x.io', role: 'customer' as never };
const dto = { rawRequest: 'a padel coach' };

describe('ReportService.create — credits before the free slot, charge only on delivery', () => {
  it('with enough credits: paid full report, no free-slot claim, nothing held (pay-on-delivery)', async () => {
    const { svc, credits, reports, boss } = makeService({ balance: 5, freeSlot: true });
    await svc.create({ dto, viewer });
    expect(credits.claimFreeReport).not.toHaveBeenCalled();
    expect(reports.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ freeReport: false }) }));
    // `created` lifecycle: intake acknowledges the customer (RECEIVED has no inbound transition).
    expect(boss.enqueue).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'report_received' }) }));
  });

  it('with no credits + free slot available: falls back to the freemium report', async () => {
    const { svc, credits, reports } = makeService({ balance: 0, freeSlot: true });
    await svc.create({ dto, viewer });
    expect(credits.claimFreeReport).toHaveBeenCalled();
    expect(reports.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ freeReport: true }) }));
  });

  it('with no credits + free slot spent: 402, no report row', async () => {
    const { svc, reports } = makeService({ balance: 0, freeSlot: false });
    await expect(svc.create({ dto, viewer })).rejects.toThrow(PaymentRequiredError);
    expect(reports.create).not.toHaveBeenCalled();
  });

  it('a freemium report also enqueues the admin tracking alert (ops)', async () => {
    const { svc, boss } = makeService({ balance: 0, freeSlot: true });
    await svc.create({ dto, viewer });
    expect(boss.enqueue).toHaveBeenCalledWith(expect.objectContaining({ job: 'notify_admins_freemium', data: { reportId: 'r1' } }));
  });

  it('a paid report does NOT alert admins (only free-tier runs are tracked)', async () => {
    const { svc, boss } = makeService({ balance: 5, freeSlot: true });
    await svc.create({ dto, viewer });
    expect(boss.enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ job: 'notify_admins_freemium' }));
  });
});

/** Admin report search (the operator picker): cursor pagination over the repository. */
function makeSearchService(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ id: `r${i + 1}` }));
  const reports = { searchAdmin: jest.fn(async ({ take }: { take: number }) => rows.slice(0, take + 1)) };
  const svc = new ReportService({} as never, reports as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, reports };
}

describe('ReportService.search — cursor pagination for the operator picker', () => {
  it('defaults to a 10-row page (the "last 10 reports" default view)', async () => {
    const { svc, reports } = makeSearchService(3);
    await svc.search({});
    expect(reports.searchAdmin).toHaveBeenCalledWith({ q: undefined, take: 10, cursorId: undefined });
  });

  it('a short page (fewer rows than the limit) has no next cursor', async () => {
    const { svc } = makeSearchService(3);
    const page = await svc.search({ limit: 10 });
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it('a full page trims the +1 probe row and points the cursor at its own last row', async () => {
    const { svc } = makeSearchService(11);
    const page = await svc.search({ limit: 10 });
    expect(page.rows).toHaveLength(10);
    expect(page.nextCursor).toBe('r10'); // the last VISIBLE row — not the probe row
  });

  it('threads q + cursor through to the repository', async () => {
    const { svc, reports } = makeSearchService(1);
    await svc.search({ q: 'RPT-260711', limit: 5, cursor: 'r42' });
    expect(reports.searchAdmin).toHaveBeenCalledWith({ q: 'RPT-260711', take: 5, cursorId: 'r42' });
  });
});

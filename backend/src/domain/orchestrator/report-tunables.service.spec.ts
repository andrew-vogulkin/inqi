import { ReportState } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ReportTunablesService } from './report-tunables.service';

describe('ReportTunablesService (report genes, carrier B)', () => {
  const stateRows = [
    { name: ReportState.FUNNEL, config: { targetQualifiedOptions: 3, breadthCap: 99 } }, // breadthCap clamps to 16
    { name: ReportState.OUTREACH, config: { widenBatch: 4 } },
    { name: ReportState.RECEIVED, config: null },
  ];
  const makeDb = () => ({
    workflowState: { findMany: jest.fn().mockResolvedValue(stateRows) },
    report: { findUnique: jest.fn().mockResolvedValue({ workflowVersionId: 'v1' }) },
  });

  it('resolves the pinned version\'s genes, clamped to registry bounds', async () => {
    const db = makeDb();
    const svc = new ReportTunablesService(db as unknown as PrismaService);
    await expect(svc.forVersion({ workflowVersionId: 'v1' })).resolves.toEqual({ targetQualifiedOptions: 3, breadthCap: 16, widenBatch: 4 });
  });

  it('caches per version — published versions are immutable', async () => {
    const db = makeDb();
    const svc = new ReportTunablesService(db as unknown as PrismaService);
    await svc.forVersion({ workflowVersionId: 'v1' });
    await svc.forVersion({ workflowVersionId: 'v1' });
    expect(db.workflowState.findMany).toHaveBeenCalledTimes(1);
  });

  it('forReport resolves through the report\'s pinned version', async () => {
    const db = makeDb();
    const svc = new ReportTunablesService(db as unknown as PrismaService);
    await expect(svc.forReport({ reportId: 'r1' })).resolves.toMatchObject({ widenBatch: 4 });
    expect(db.report.findUnique).toHaveBeenCalledWith({ where: { id: 'r1' }, select: { workflowVersionId: true } });
  });

  it('an unconfigured version resolves {} — every consumer falls back to today\'s constants', async () => {
    const db = makeDb();
    db.workflowState.findMany.mockResolvedValue([{ name: ReportState.FUNNEL, config: null }]);
    const svc = new ReportTunablesService(db as unknown as PrismaService);
    await expect(svc.forVersion({ workflowVersionId: 'v2' })).resolves.toEqual({});
  });
});

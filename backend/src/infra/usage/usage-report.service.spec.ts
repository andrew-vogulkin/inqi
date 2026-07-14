import { UsageKind, WebSearchSource } from '@inqi/shared';
import type { ConfigService } from '../config/config.service';
import { UsageReportService } from './usage-report.service';

const prices = {
  currency: 'USD',
  models: { qwen: { promptPer1k: 0.1, completionPer1k: 0.2 } },
  perEmail: 0.003, perReplyProcessed: 0, perDiscoveryCall: 0, perBackgroundResearch: 0, perEmbedding: 0, perWebSearch: 0.0005,
} as unknown as ConfigService['prices'];

/** A UsageRecord-shaped row (only the columns the rollup reads). */
const rec = (reportId: string, over: Record<string, unknown>) => ({
  reportId, kind: UsageKind.AiCall, model: 'qwen', source: null, promptTokens: 0, completionTokens: 0, totalTokens: 0, quantity: 1, ...over,
});

function make({ reports, records }: { reports: unknown[]; records: unknown[] }) {
  const reportFindMany = jest.fn().mockResolvedValue(reports);
  const usageFindMany = jest.fn().mockResolvedValue(records);
  const db = { report: { findMany: reportFindMany }, usageRecord: { findMany: usageFindMany } };
  const config = { prices } as unknown as ConfigService;
  return { svc: new UsageReportService(db as never, config), reportFindMany, usageFindMany };
}

const REPORTS = [
  { id: 'r1', ref: 'RPT-1', state: 'REPORT_DELIVERED', createdAt: new Date('2026-07-05T10:00:00Z'), customerEmail: 'a@x.io' },
  { id: 'r2', ref: 'RPT-2', state: 'FAILED', createdAt: new Date('2026-07-06T10:00:00Z'), customerEmail: 'b@x.io' },
];
const RECORDS = [
  rec('r1', { kind: UsageKind.AiCall, promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 }), // $0.10 + $0.20 = $0.30
  rec('r1', { kind: UsageKind.WebSearch, model: 'searxng', source: WebSearchSource.BreadthSearch }),      // $0.0005
  rec('r1', { kind: UsageKind.EmailSent }),                                                               // $0.003
  rec('r2', { kind: UsageKind.WebSearch, model: 'searxng', source: WebSearchSource.DepthSearch }),         // $0.0005
];

describe('UsageReportService.summary (HP-15)', () => {
  it('rolls up combined totals AND per-report breakdown', async () => {
    const { svc } = make({ reports: REPORTS, records: RECORDS });
    const out = await svc.summary({ from: '2026-07-01', to: '2026-07-13' });

    expect(out.reportCount).toBe(2);
    // combined: $0.30 tokens + 2 searches × $0.0005 + 1 email × $0.003 = 0.3040
    expect(out.totals.grandTotalUsd).toBeCloseTo(0.304, 6);
    expect(out.totals.webSearch.calls).toBe(2);
    expect(out.totals.webSearch.bySource.map((s) => s.source)).toEqual([WebSearchSource.BreadthSearch, WebSearchSource.DepthSearch]);

    const r1 = out.reports.find((r) => r.id === 'r1')!;
    const r2 = out.reports.find((r) => r.id === 'r2')!;
    expect(r1).toMatchObject({ ref: 'RPT-1', tokenTotal: 2000, webSearchCalls: 1, emailCount: 1 });
    expect(r1.costUsd).toBeCloseTo(0.3035, 6); // 0.30 + 0.0005 search + 0.003 email
    expect(r2).toMatchObject({ ref: 'RPT-2', tokenTotal: 0, webSearchCalls: 1, emailCount: 0 });
    expect(r2.costUsd).toBeCloseTo(0.0005, 6);
  });

  it('translates a plain YYYY-MM-DD window into an inclusive UTC day range', async () => {
    const { svc, reportFindMany } = make({ reports: [], records: [] });
    await svc.summary({ from: '2026-07-01', to: '2026-07-13' });
    const where = reportFindMany.mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(where.createdAt.lte.toISOString()).toBe('2026-07-13T23:59:59.999Z');
  });

  it('skips the usage query when the window has no reports', async () => {
    const { svc, usageFindMany } = make({ reports: [], records: [] });
    const out = await svc.summary({});
    expect(usageFindMany).not.toHaveBeenCalled();
    expect(out).toMatchObject({ reportCount: 0, from: null, to: null });
    expect(out.totals.grandTotalUsd).toBe(0);
  });
});

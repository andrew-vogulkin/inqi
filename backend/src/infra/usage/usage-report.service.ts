import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma.service';
import { ConfigService } from '../config/config.service';
import { CostSummary, rollupCost, UsageRow } from './cost';

/** One report's line in the aggregate usage report. */
export interface UsageReportRow {
  id: string;
  ref: string | null;
  state: string;
  createdAt: string;
  customerEmail: string;
  costUsd: number;
  tokenTotal: number;
  webSearchCalls: number;
  emailCount: number;
}

export interface UsageReportResult {
  from: string | null;
  to: string | null;
  reportCount: number;
  totals: CostSummary;
  reports: UsageReportRow[];
}

/** Safety cap on how many reports one window can roll up (dev-scale; bounds the query). */
const MAX_REPORTS = 500;

/**
 * Aggregate usage across all reports in a date window (HP-15). Rolls the whole
 * cohort's ledger into one {@link CostSummary} (the same rollup as the per-report
 * cost view) and also returns each report's individual totals for visibility.
 * Reports are selected by their `createdAt`; `from`/`to` accept a plain date
 * (`YYYY-MM-DD`, treated as an inclusive UTC day) or a full ISO timestamp.
 */
@Injectable()
export class UsageReportService {
  constructor(private readonly db: PrismaService, private readonly config: ConfigService) {}

  async summary({ from, to, limit = MAX_REPORTS }: { from?: string; to?: string; limit?: number }): Promise<UsageReportResult> {
    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = boundaryDate(from, 'start');
    if (to) createdAt.lte = boundaryDate(to, 'end');

    const reports = await this.db.report.findMany({
      where: from || to ? { createdAt } : {},
      select: { id: true, ref: true, state: true, createdAt: true, customerEmail: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), MAX_REPORTS),
    });

    const ids = reports.map((r) => r.id);
    const rows: UsageRow[] = ids.length
      ? await this.db.usageRecord.findMany({ where: { reportId: { in: ids } } })
      : [];

    // Group the ledger by report once, so each report rolls up from its own slice.
    const byReport = new Map<string, UsageRow[]>();
    for (const r of rows as (UsageRow & { reportId: string })[]) {
      const list = byReport.get(r.reportId);
      if (list) list.push(r); else byReport.set(r.reportId, [r]);
    }

    const priceTable = this.config.prices;
    const reportRows: UsageReportRow[] = reports.map((rep) => {
      const c = rollupCost({ usageRecords: byReport.get(rep.id) ?? [], priceTable });
      return {
        id: rep.id,
        ref: rep.ref,
        state: rep.state,
        createdAt: rep.createdAt.toISOString(),
        customerEmail: rep.customerEmail,
        costUsd: c.grandTotalUsd,
        tokenTotal: c.tokenTotal,
        webSearchCalls: c.webSearch.calls,
        emailCount: c.outreach.emails,
      };
    });

    return {
      from: from ?? null,
      to: to ?? null,
      reportCount: reports.length,
      totals: rollupCost({ usageRecords: rows, priceTable }),
      reports: reportRows,
    };
  }
}

/** Parse a `YYYY-MM-DD` (inclusive UTC day) or a full ISO string to a Date. */
function boundaryDate(value: string, edge: 'start' | 'end'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);
  }
  return new Date(value);
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InquiryStatus } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the Report aggregate. */
@Injectable()
export class ReportRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  create({ data, tx }: { data: Prisma.ReportUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).report.create({ data });
  }

  /** How many refs were minted with this day-prefix (drives the per-day counter). */
  countByRefPrefix({ prefix, tx }: { prefix: string; tx?: DbTx }) {
    return this.exec(tx).report.count({ where: { ref: { startsWith: prefix } } });
  }

  findWithRelations({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUniqueOrThrow({
      where: { id },
      include: {
        subject: true,
        questionnaire: true,
        // Each inquiry carries its Source matrix (websearch/rating/email rows) for the board.
        // SourceDto fields only — never the reply address / conv state (those stay admin-thread-side).
        epics: {
          include: {
            inquiries: {
              include: {
                sources: {
                  select: { id: true, inquiryId: true, type: true, url: true, title: true, snippet: true, createdAt: true },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
        snapshot: true,
      },
    });
  }

  listRecent({ take = 100, tx }: { take?: number; tx?: DbTx } = {}) {
    return this.exec(tx).report.findMany({ orderBy: { createdAt: 'desc' }, take });
  }

  /** A single customer's reports — owned by FK or (pre-auth) by matching email. */
  listForOwner({ customerId, email, take = 100, tx }: { customerId: string; email: string; take?: number; tx?: DbTx }) {
    return this.exec(tx).report.findMany({
      where: { OR: [{ customerId }, { customerEmail: email }] },
      orderBy: { createdAt: 'desc' }, take,
    });
  }

  /** Backfill ownership on sign-in: claim any unowned reports submitted with this email. */
  linkOwnerByEmail({ email, customerId, tx }: { email: string; customerId: string; tx?: DbTx }) {
    return this.exec(tx).report.updateMany({ where: { customerEmail: email, customerId: null }, data: { customerId } });
  }

  /** HP-23: qualified-inquiry count per report (direct Inquiry.reportId FK), for the stage projection. */
  async qualifiedCountsByReport({ reportIds, tx }: { reportIds: string[]; tx?: DbTx }): Promise<Record<string, number>> {
    if (!reportIds.length) return {};
    const rows = await this.exec(tx).$queryRaw<{ reportId: string; count: bigint }[]>`
      SELECT i."reportId" AS "reportId", COUNT(*)::bigint AS count
      FROM "Inquiry" i
      WHERE i.status = ${InquiryStatus.Qualified} AND i."reportId" IN (${Prisma.join(reportIds)})
      GROUP BY i."reportId"`;
    return Object.fromEntries(rows.map((r) => [r.reportId, Number(r.count)]));
  }
}

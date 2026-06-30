import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SubtaskStatus } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the Inquiry aggregate. */
@Injectable()
export class InquiryRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  create({ data, tx }: { data: Prisma.InquiryUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).inquiry.create({ data });
  }

  findWithRelations({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.findUniqueOrThrow({
      where: { id },
      include: { subject: true, questionnaire: true, epics: { include: { subtasks: true } }, report: true },
    });
  }

  listRecent({ take = 100, tx }: { take?: number; tx?: DbTx } = {}) {
    return this.exec(tx).inquiry.findMany({ orderBy: { createdAt: 'desc' }, take });
  }

  /** A single customer's inquiries — owned by FK or (pre-auth) by matching email. */
  listForOwner({ customerId, email, take = 100, tx }: { customerId: string; email: string; take?: number; tx?: DbTx }) {
    return this.exec(tx).inquiry.findMany({
      where: { OR: [{ customerId }, { customerEmail: email }] },
      orderBy: { createdAt: 'desc' }, take,
    });
  }

  /** Backfill ownership on sign-in: claim any unowned inquiries submitted with this email. */
  linkOwnerByEmail({ email, customerId, tx }: { email: string; customerId: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.updateMany({ where: { customerEmail: email, customerId: null }, data: { customerId } });
  }

  /** HP-23: qualified-subtask count per inquiry (Subtask→Epic join), for the stage projection. */
  async qualifiedCountsByInquiry({ inquiryIds, tx }: { inquiryIds: string[]; tx?: DbTx }): Promise<Record<string, number>> {
    if (!inquiryIds.length) return {};
    const rows = await this.exec(tx).$queryRaw<{ inquiryId: string; count: bigint }[]>`
      SELECT e."inquiryId" AS "inquiryId", COUNT(*)::bigint AS count
      FROM "Subtask" s JOIN "Epic" e ON s."epicId" = e.id
      WHERE s.status = ${SubtaskStatus.Qualified} AND e."inquiryId" IN (${Prisma.join(inquiryIds)})
      GROUP BY e."inquiryId"`;
    return Object.fromEntries(rows.map((r) => [r.inquiryId, Number(r.count)]));
  }
}

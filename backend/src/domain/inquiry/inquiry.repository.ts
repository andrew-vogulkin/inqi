import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the Inquiry aggregate. */
@Injectable()
export class InquiryRepository {
  constructor(private readonly db: PrismaService) {}

  create({ data }: { data: Prisma.InquiryUncheckedCreateInput }) {
    return this.db.inquiry.create({ data });
  }

  /** Remove a just-created inquiry (HP-19: roll back when a credit reservation loses a race). */
  delete({ id }: { id: string }) {
    return this.db.inquiry.delete({ where: { id } });
  }

  findWithRelations({ id }: { id: string }) {
    return this.db.inquiry.findUniqueOrThrow({
      where: { id },
      include: { subject: true, questionnaire: true, epics: { include: { subtasks: true } }, report: true },
    });
  }

  listRecent({ take = 100 }: { take?: number } = {}) {
    return this.db.inquiry.findMany({ orderBy: { createdAt: 'desc' }, take });
  }

  /** A single customer's inquiries — owned by FK or (pre-auth) by matching email. */
  listForOwner({ customerId, email, take = 100 }: { customerId: string; email: string; take?: number }) {
    return this.db.inquiry.findMany({
      where: { OR: [{ customerId }, { customerEmail: email }] },
      orderBy: { createdAt: 'desc' }, take,
    });
  }

  /** Backfill ownership on sign-in: claim any unowned inquiries submitted with this email. */
  linkOwnerByEmail({ email, customerId }: { email: string; customerId: string }) {
    return this.db.inquiry.updateMany({ where: { customerEmail: email, customerId: null }, data: { customerId } });
  }

  /** HP-23: qualified-subtask count per inquiry (Subtask→Epic join), for the stage projection. */
  async qualifiedCountsByInquiry({ inquiryIds }: { inquiryIds: string[] }): Promise<Record<string, number>> {
    if (!inquiryIds.length) return {};
    const rows = await this.db.$queryRaw<{ inquiryId: string; count: bigint }[]>`
      SELECT e."inquiryId" AS "inquiryId", COUNT(*)::bigint AS count
      FROM "Subtask" s JOIN "Epic" e ON s."epicId" = e.id
      WHERE s.status = 'qualified' AND e."inquiryId" IN (${Prisma.join(inquiryIds)})
      GROUP BY e."inquiryId"`;
    return Object.fromEntries(rows.map((r) => [r.inquiryId, Number(r.count)]));
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MessageDirection } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the outreach communication track (messages + thread reads). */
@Injectable()
export class EmailChannelRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  createMessage({ data, tx }: { data: Prisma.MessageUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).message.create({ data });
  }

  findMessageByExternalId({ externalId, tx }: { externalId: string; tx?: DbTx }) {
    return this.exec(tx).message.findUnique({ where: { externalId } });
  }

  listThread({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).message.findMany({ where: { inquiryId }, orderBy: { createdAt: 'asc' } });
  }

  /** First outbound message on an inquiry, if any — used to make the initial send idempotent. */
  findFirstOutbound({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).message.findFirst({ where: { inquiryId, direction: MessageDirection.Outbound }, orderBy: { createdAt: 'asc' } });
  }

  findInquiry({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.findUniqueOrThrow({ where: { id } });
  }

  /** The owning report (persona lookup — one persona speaks for the whole report). */
  findReport({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUniqueOrThrow({ where: { id }, select: { id: true, personaId: true } });
  }

  findEpicWithInquiries({ epicId, tx }: { epicId: string; tx?: DbTx }) {
    return this.exec(tx).epic.findUniqueOrThrow({ where: { id: epicId }, include: { inquiries: true } });
  }

  findSubjectByEpic({ epicId, tx }: { epicId: string; tx?: DbTx }) {
    return this.exec(tx).subject.findFirst({ where: { report: { epics: { some: { id: epicId } } } } });
  }
}

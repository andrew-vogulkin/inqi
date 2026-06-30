import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the outreach communication track (messages + thread reads). */
@Injectable()
export class OutreachRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  createMessage({ data, tx }: { data: Prisma.InquiryMessageUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).inquiryMessage.create({ data });
  }

  findMessageByExternalId({ externalId, tx }: { externalId: string; tx?: DbTx }) {
    return this.exec(tx).inquiryMessage.findUnique({ where: { externalId } });
  }

  listThread({ subtaskId, tx }: { subtaskId: string; tx?: DbTx }) {
    return this.exec(tx).inquiryMessage.findMany({ where: { subtaskId }, orderBy: { createdAt: 'asc' } });
  }

  /** First outbound message on a subtask, if any — used to make the initial send idempotent. */
  findFirstOutbound({ subtaskId, tx }: { subtaskId: string; tx?: DbTx }) {
    return this.exec(tx).inquiryMessage.findFirst({ where: { subtaskId, direction: 'outbound' }, orderBy: { createdAt: 'asc' } });
  }

  findSubtask({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).subtask.findUniqueOrThrow({ where: { id } });
  }

  findSubtaskByReplyAddress({ replyAddress, tx }: { replyAddress: string; tx?: DbTx }) {
    return this.exec(tx).subtask.findFirst({ where: { replyAddress }, include: { epic: true } });
  }

  findEpicWithSubtasks({ epicId, tx }: { epicId: string; tx?: DbTx }) {
    return this.exec(tx).epic.findUniqueOrThrow({ where: { id: epicId }, include: { subtasks: true } });
  }

  findSubjectByEpic({ epicId, tx }: { epicId: string; tx?: DbTx }) {
    return this.exec(tx).subject.findFirst({ where: { inquiry: { epics: { some: { id: epicId } } } } });
  }
}

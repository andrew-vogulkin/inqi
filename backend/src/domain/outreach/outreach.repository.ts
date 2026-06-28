import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the outreach communication track (messages + thread reads). */
@Injectable()
export class OutreachRepository {
  constructor(private readonly db: PrismaService) {}

  createMessage({ data }: { data: Prisma.InquiryMessageUncheckedCreateInput }) {
    return this.db.inquiryMessage.create({ data });
  }

  findMessageByExternalId({ externalId }: { externalId: string }) {
    return this.db.inquiryMessage.findUnique({ where: { externalId } });
  }

  listThread({ subtaskId }: { subtaskId: string }) {
    return this.db.inquiryMessage.findMany({ where: { subtaskId }, orderBy: { createdAt: 'asc' } });
  }

  /** First outbound message on a subtask, if any — used to make the initial send idempotent. */
  findFirstOutbound({ subtaskId }: { subtaskId: string }) {
    return this.db.inquiryMessage.findFirst({ where: { subtaskId, direction: 'outbound' }, orderBy: { createdAt: 'asc' } });
  }

  findSubtask({ id }: { id: string }) {
    return this.db.subtask.findUniqueOrThrow({ where: { id } });
  }

  findSubtaskByReplyAddress({ replyAddress }: { replyAddress: string }) {
    return this.db.subtask.findFirst({ where: { replyAddress }, include: { epic: true } });
  }

  findEpicWithSubtasks({ epicId }: { epicId: string }) {
    return this.db.epic.findUniqueOrThrow({ where: { id: epicId }, include: { subtasks: true } });
  }

  findSubjectByEpic({ epicId }: { epicId: string }) {
    return this.db.subject.findFirst({ where: { inquiry: { epics: { some: { id: epicId } } } } });
  }
}

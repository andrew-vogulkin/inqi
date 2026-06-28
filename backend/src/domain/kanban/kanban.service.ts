import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/persistence/prisma.service';

/**
 * Read/projection over epics + subtasks + messages (the CQRS query side). All
 * task-state *mutations* live in the orchestrator/agent — this module only reads.
 */
@Injectable()
export class KanbanService {
  constructor(private readonly db: PrismaService) {}

  /** Full email thread for a subtask (admin / report timeline). */
  thread({ subtaskId }: { subtaskId: string }) {
    return this.db.inquiryMessage.findMany({ where: { subtaskId }, orderBy: { createdAt: 'asc' } });
  }
}

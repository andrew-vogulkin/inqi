import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/persistence/prisma.service';

/**
 * Read/projection over epics + inquiries + messages (the CQRS query side). All
 * task-state *mutations* live in the orchestrator/agent — this module only reads.
 */
@Injectable()
export class KanbanService {
  constructor(private readonly db: PrismaService) {}

  /** Full email thread for an inquiry (admin / report timeline). */
  thread({ inquiryId }: { inquiryId: string }) {
    return this.db.message.findMany({ where: { inquiryId }, orderBy: { createdAt: 'asc' } });
  }
}

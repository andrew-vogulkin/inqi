import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for agent-owned writes: subtask state + findings. */
@Injectable()
export class AgentRepository {
  constructor(private readonly db: PrismaService) {}

  findSubtask({ id }: { id: string }) {
    return this.db.subtask.findUniqueOrThrow({ where: { id } });
  }

  updateSubtask({ id, data }: { id: string; data: Prisma.SubtaskUncheckedUpdateInput }) {
    return this.db.subtask.update({ where: { id }, data });
  }

  createFinding({ data }: { data: Prisma.FindingUncheckedCreateInput }) {
    return this.db.finding.create({ data });
  }

  /** Existing finding of a kind for a subtask — guards against duplicate findings on job retries. */
  findFinding({ subtaskId, kind }: { subtaskId: string; kind: string }) {
    return this.db.finding.findFirst({ where: { subtaskId, kind } });
  }
}

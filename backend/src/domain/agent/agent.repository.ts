import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for agent-owned writes: subtask state + findings. */
@Injectable()
export class AgentRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findSubtask({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).subtask.findUniqueOrThrow({ where: { id } });
  }

  updateSubtask({ id, data, tx }: { id: string; data: Prisma.SubtaskUncheckedUpdateInput; tx?: DbTx }) {
    return this.exec(tx).subtask.update({ where: { id }, data });
  }

  createFinding({ data, tx }: { data: Prisma.FindingUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).finding.create({ data });
  }

  /** Existing finding of a kind for a subtask — guards against duplicate findings on job retries. */
  findFinding({ subtaskId, kind, tx }: { subtaskId: string; kind: string; tx?: DbTx }) {
    return this.exec(tx).finding.findFirst({ where: { subtaskId, kind } });
  }
}

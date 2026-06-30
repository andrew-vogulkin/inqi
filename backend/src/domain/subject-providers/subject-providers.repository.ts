import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for subject-provider background research. */
@Injectable()
export class SubjectProvidersRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findSubtask({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).subtask.findUniqueOrThrow({ where: { id } });
  }

  updateBackground({ id, background, qualityScore, tx }: { id: string; background: Prisma.InputJsonValue; qualityScore: number; tx?: DbTx }) {
    return this.exec(tx).subtask.update({ where: { id }, data: { background, qualityScore } });
  }

  createFinding({ data, tx }: { data: Prisma.FindingUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).finding.create({ data });
  }
}

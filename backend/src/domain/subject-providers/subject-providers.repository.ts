import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for subject-provider background research. */
@Injectable()
export class SubjectProvidersRepository {
  constructor(private readonly db: PrismaService) {}

  findSubtask({ id }: { id: string }) {
    return this.db.subtask.findUniqueOrThrow({ where: { id } });
  }

  updateBackground({ id, background, qualityScore }: { id: string; background: Prisma.InputJsonValue; qualityScore: number }) {
    return this.db.subtask.update({ where: { id }, data: { background, qualityScore } });
  }

  createFinding({ data }: { data: Prisma.FindingUncheckedCreateInput }) {
    return this.db.finding.create({ data });
  }
}

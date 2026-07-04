import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the Questionnaire aggregate. */
@Injectable()
export class QuestionnaireRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  create({ data, tx }: { data: Prisma.QuestionnaireUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).questionnaire.create({ data });
  }

  findByToken({ token, tx }: { token: string; tx?: DbTx }) {
    return this.exec(tx).questionnaire.findUnique({ where: { token } });
  }

  findByReport({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).questionnaire.findUnique({ where: { reportId } });
  }

  /** HP-24: the owner-identifying fields of the report this questionnaire belongs to. */
  reportOwner({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { id: reportId }, select: { customerId: true, customerEmail: true } });
  }

  update({ token, data, tx }: { token: string; data: Prisma.QuestionnaireUncheckedUpdateInput; tx?: DbTx }) {
    return this.exec(tx).questionnaire.update({ where: { token }, data });
  }
}

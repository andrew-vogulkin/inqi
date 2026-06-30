import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for the Questionnaire aggregate. */
@Injectable()
export class QuestionnaireRepository {
  constructor(private readonly db: PrismaService) {}

  create({ data }: { data: Prisma.QuestionnaireUncheckedCreateInput }) {
    return this.db.questionnaire.create({ data });
  }

  findByToken({ token }: { token: string }) {
    return this.db.questionnaire.findUnique({ where: { token } });
  }

  findByInquiry({ inquiryId }: { inquiryId: string }) {
    return this.db.questionnaire.findUnique({ where: { inquiryId } });
  }

  /** HP-24: the owner-identifying fields of the inquiry this questionnaire belongs to. */
  inquiryOwner({ inquiryId }: { inquiryId: string }) {
    return this.db.inquiry.findUnique({ where: { id: inquiryId }, select: { customerId: true, customerEmail: true } });
  }

  update({ token, data }: { token: string; data: Prisma.QuestionnaireUncheckedUpdateInput }) {
    return this.db.questionnaire.update({ where: { token }, data });
  }
}

import { Injectable } from '@nestjs/common';
import { InquiryState } from '@inqi/shared';
import { PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for notifications (reads + the exactly-once reminder claim). */
@Injectable()
export class NotificationRepository {
  constructor(private readonly db: PrismaService) {}

  findInquiry({ id }: { id: string }) {
    return this.db.inquiry.findUnique({ where: { id }, select: { id: true, customerEmail: true, state: true, denyReason: true } });
  }

  findReportByInquiry({ inquiryId }: { inquiryId: string }) {
    return this.db.report.findUnique({ where: { inquiryId }, select: { token: true } });
  }

  findCustomerByEmail({ email }: { email: string }) {
    return this.db.customer.findUnique({ where: { email }, select: { notificationsOptOut: true } });
  }

  /**
   * Unfilled, un-reminded questionnaires whose expiry falls inside the lead window
   * AND whose inquiry is still awaiting the customer (QUESTIONNAIRE_SENT) — so we
   * never remind on a denied/blocked or already-progressed inquiry.
   */
  findDueReminders({ now, windowEnd }: { now: Date; windowEnd: Date }) {
    return this.db.questionnaire.findMany({
      where: {
        filledAt: null, reminderSentAt: null, expiresAt: { gt: now, lte: windowEnd },
        inquiry: { state: InquiryState.QUESTIONNAIRE_SENT },
      },
      select: { id: true, token: true, inquiryId: true, expiresAt: true, inquiry: { select: { customerEmail: true } } },
      take: 200,
    });
  }

  /** Atomically claim the reminder slot — returns 1 only for the winner (exactly-once). */
  async claimReminder({ id }: { id: string }): Promise<number> {
    const r = await this.db.questionnaire.updateMany({ where: { id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    return r.count;
  }
}

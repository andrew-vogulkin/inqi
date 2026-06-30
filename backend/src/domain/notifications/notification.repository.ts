import { Injectable } from '@nestjs/common';
import { InquiryState } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for notifications (reads + the exactly-once reminder claim). */
@Injectable()
export class NotificationRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findInquiry({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.findUnique({ where: { id }, select: { id: true, customerEmail: true, state: true, denyReason: true } });
  }

  findReportByInquiry({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { inquiryId }, select: { token: true } });
  }

  findCustomerByEmail({ email, tx }: { email: string; tx?: DbTx }) {
    return this.exec(tx).customer.findUnique({ where: { email }, select: { notificationsOptOut: true } });
  }

  /**
   * Unfilled, un-reminded questionnaires whose expiry falls inside the lead window
   * AND whose inquiry is still awaiting the customer (QUESTIONNAIRE_SENT) — so we
   * never remind on a denied/blocked or already-progressed inquiry.
   */
  findDueReminders({ now, windowEnd, tx }: { now: Date; windowEnd: Date; tx?: DbTx }) {
    return this.exec(tx).questionnaire.findMany({
      where: {
        filledAt: null, reminderSentAt: null, expiresAt: { gt: now, lte: windowEnd },
        inquiry: { state: InquiryState.QUESTIONNAIRE_SENT },
      },
      select: { id: true, token: true, inquiryId: true, expiresAt: true, inquiry: { select: { customerEmail: true } } },
      take: 200,
    });
  }

  /** Atomically claim the reminder slot — returns 1 only for the winner (exactly-once). */
  async claimReminder({ id, tx }: { id: string; tx?: DbTx }): Promise<number> {
    const r = await this.exec(tx).questionnaire.updateMany({ where: { id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    return r.count;
  }
}

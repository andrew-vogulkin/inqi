import { Injectable } from '@nestjs/common';
import { AuthRole, ReportState } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for notifications (reads + the exactly-once reminder claim). */
@Injectable()
export class NotificationRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  findReport({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).report.findUnique({ where: { id }, select: { id: true, ref: true, customerEmail: true, state: true, denyReason: true, rawRequest: true } });
  }

  /** Admin recipients for ops alerts (e.g. a free report was run). Empty = no admins configured. */
  async findAdminEmails({ tx }: { tx?: DbTx } = {}): Promise<string[]> {
    const rows = await this.exec(tx).customer.findMany({ where: { role: AuthRole.Admin }, select: { email: true } });
    return rows.map((r) => r.email);
  }

  /** The questionnaire's capability token + expiry (for the needs-you email). */
  findQuestionnaireByReport({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).questionnaire.findUnique({ where: { reportId }, select: { token: true, expiresAt: true, confirmed: true } });
  }

  /** The snapshot's email-facing content: summary + ranked options + the freemium lock state. */
  findSnapshotByReport({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).reportSnapshot.findUnique({
      where: { reportId },
      select: { token: true, summary: true, options: true, freemium: true, unlocked: true },
    });
  }

  findCustomerByEmail({ email, tx }: { email: string; tx?: DbTx }) {
    return this.exec(tx).customer.findUnique({ where: { email }, select: { notificationsOptOut: true } });
  }

  /**
   * Unfilled, un-reminded questionnaires whose expiry falls inside the lead window
   * AND whose report is still awaiting the customer (QUESTIONNAIRE_SENT) — so we
   * never remind on a denied/blocked or already-progressed report.
   */
  findDueReminders({ now, windowEnd, tx }: { now: Date; windowEnd: Date; tx?: DbTx }) {
    return this.exec(tx).questionnaire.findMany({
      where: {
        filledAt: null, reminderSentAt: null, expiresAt: { gt: now, lte: windowEnd },
        report: { state: ReportState.QUESTIONNAIRE_SENT },
      },
      select: { id: true, token: true, reportId: true, expiresAt: true, report: { select: { customerEmail: true } } },
      take: 200,
    });
  }

  /** Atomically claim the reminder slot — returns 1 only for the winner (exactly-once). */
  async claimReminder({ id, tx }: { id: string; tx?: DbTx }): Promise<number> {
    const r = await this.exec(tx).questionnaire.updateMany({ where: { id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    return r.count;
  }
}

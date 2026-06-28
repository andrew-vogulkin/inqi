import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventType, NotificationKind, QueueJob } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ConfigService } from '../../infra/config/config.service';
import { NotificationRepository } from './notification.repository';
import { NOTIFICATION_CHANNEL, NotificationChannel } from './notification.tokens';
import { isReminderDue, renderNotification } from './notification.templates';

/**
 * Customer notifications (HP-13): report-ready + denial are dispatched from the
 * `SendNotification` queue job; questionnaire-expiry reminders from an in-process
 * sweep (Postgres-only, exactly-once via a claim). All sends go through the
 * {@link NOTIFICATION_CHANNEL} (email → MailProvider), respect opt-out, and emit
 * `notification.sent`.
 */
@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly repo: NotificationRepository,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    @Inject(NOTIFICATION_CHANNEL) private readonly channel: NotificationChannel,
  ) {}

  async onModuleInit() {
    await this.boss.work<{ inquiryId: string; kind: NotificationKind }>({ job: QueueJob.SendNotification, handler: (j) => this.handle(j.data) });
    this.sweepTimer = setInterval(() => { void this.sweepReminders(); }, this.config.notifications.sweepIntervalMs);
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Event-driven sends: report-ready + denial. */
  private async handle({ inquiryId, kind }: { inquiryId: string; kind: NotificationKind }): Promise<void> {
    const inq = await this.repo.findInquiry({ id: inquiryId });
    if (!inq) return;
    if (await this.optedOut(inq.customerEmail)) { this.logger.log(`notification ${kind} suppressed (opt-out) for ${inq.customerEmail}`); return; }

    const ctx = kind === NotificationKind.ReportReady
      ? { reportUrl: this.reportUrl(inquiryId) }
      : { reason: inq.denyReason ?? undefined };
    const { subject, body } = renderNotification(kind, ctx);
    await this.channel.send({ to: inq.customerEmail, subject, body });
    await this.outbox.emit({ type: EventType.NotificationSent, inquiryId, data: { kind, to: inq.customerEmail } });
    this.logger.log(`notification ${kind} sent to ${inq.customerEmail}`);
  }

  /** Scheduled sweep: send exactly one expiry reminder per questionnaire within the lead window. */
  private async sweepReminders(): Promise<void> {
    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + this.config.notifications.reminderLeadHours * 3600_000);
      const due = await this.repo.findDueReminders({ now, windowEnd });
      for (const q of due) {
        const email = q.inquiry.customerEmail;
        if (!isReminderDue({ now, expiresAt: q.expiresAt, leadHours: this.config.notifications.reminderLeadHours, filledAt: null, reminderSentAt: null })) continue;
        if (await this.optedOut(email)) continue;
        if ((await this.repo.claimReminder({ id: q.id })) !== 1) continue; // someone else claimed it
        const { subject, body } = renderNotification(NotificationKind.QuestionnaireReminder, { questionnaireUrl: this.questionnaireUrl(q.token), expiresAt: q.expiresAt });
        await this.channel.send({ to: email, subject, body });
        await this.outbox.emit({ type: EventType.NotificationSent, inquiryId: q.inquiryId, data: { kind: NotificationKind.QuestionnaireReminder, to: email } });
        this.logger.log(`questionnaire reminder sent to ${email}`);
      }
    } catch (e) {
      this.logger.error(`reminder sweep failed: ${(e as Error).message}`);
    }
  }

  private async optedOut(email: string): Promise<boolean> {
    const c = await this.repo.findCustomerByEmail({ email });
    return !!c?.notificationsOptOut;
  }

  private reportUrl(inquiryId: string): string {
    return `${this.config.webBaseUrl}/#/r/${inquiryId}`; // capability webview (by inquiry id, HP-08)
  }
  private questionnaireUrl(token: string): string {
    return `${this.config.publicBaseUrl}/q/${token}`; // capability-token link
  }
}

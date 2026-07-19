import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventType, NotificationKind, QueueJob, ReportOrigin, UsageKind } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ConfigService } from '../../infra/config/config.service';
import { UsageService } from '../../infra/usage/usage.service';
import { NotificationRepository } from './notification.repository';
import { NOTIFICATION_CHANNEL, NotificationChannel } from './notification.tokens';
import { TemplateContext, TemplateOption, isReminderDue, renderNotification } from './notification.templates';

/** How many ranked options the delivered/updated emails list. */
const EMAIL_TOP_OPTIONS = 3;

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
    private readonly usage: UsageService,
  ) {}

  async onModuleInit() {
    await this.boss.work<{ reportId: string; kind: NotificationKind }>({ job: QueueJob.SendNotification, handler: (j) => this.handle(j.data) });
    await this.boss.work<{ reportId: string }>({ job: QueueJob.NotifyAdminsFreemium, handler: (j) => this.notifyAdminsOfFreemium(j.data) });
    this.sweepTimer = setInterval(() => { void this.sweepReminders(); }, this.config.notifications.sweepIntervalMs);
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Event-driven sends: report-ready / report-updated (with details) + denial. */
  private async handle({ reportId, kind }: { reportId: string; kind: NotificationKind }): Promise<void> {
    const inq = await this.repo.findReport({ id: reportId });
    if (!inq) return;
    if (await this.optedOut(inq.customerEmail)) { this.logger.log(`notification ${kind} suppressed (opt-out) for ${inq.customerEmail}`); return; }

    const ctx = await this.buildContext({ kind, reportId, inq });
    if (!ctx) return; // e.g. needs-you with no questionnaire — nothing sensible to send
    const { subject, body } = renderNotification({ kind, ctx });
    await this.channel.send({ to: inq.customerEmail, subject, body });
    void this.usage.recordAction({ reportId, kind: UsageKind.EmailSent }); // cost accounting (HP-15): notification mail = one send
    await this.outbox.emit({ type: EventType.NotificationSent, reportId, data: { kind, to: inq.customerEmail } });
    this.logger.log(`notification ${kind} sent to ${inq.customerEmail}`);
  }

  /**
   * Ops tracking (not customer-facing): a customer just ran their free (freemium)
   * report — email every admin so free-tier usage can be tracked. Fans out to all
   * `role=admin` customers; each recipient is sent independently (Postmark rewrites
   * each `to` to the approval-window override inbox with the real address tagged).
   * Not emitted into the report's activity timeline — admin addresses stay internal.
   */
  private async notifyAdminsOfFreemium({ reportId }: { reportId: string }): Promise<void> {
    const inq = await this.repo.findReport({ id: reportId });
    if (!inq) return;
    const admins = await this.repo.findAdminEmails();
    if (!admins.length) { this.logger.warn(`freemium report ${inq.ref ?? reportId} run, but no admin recipients configured`); return; }
    const ref = inq.ref ?? reportId;
    const subject = `Free report run: ${ref} — ${this.brief(inq.rawRequest)}`;
    const body = [
      'A customer just ran their free (freemium) report.',
      '',
      `Customer: ${inq.customerEmail}`,
      `Ref:      ${ref}`,
      `Request:  ${inq.rawRequest}`,
      '',
      `View: ${this.reportUrl(reportId)}`,
    ].join('\n');
    for (const to of admins) await this.channel.send({ to, subject, body });
    void this.usage.recordAction({ reportId, kind: UsageKind.EmailSent, quantity: admins.length }); // cost accounting (HP-15)
    this.logger.log(`freemium-report admin alert for ${ref} sent to ${admins.length} admin(s)`);
  }

  /** One-line request preview for an email subject. */
  private brief(text: string, max = 60): string {
    const t = text.trim().replace(/\s+/g, ' ');
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  /** Per-kind template context; null → skip the send (nothing sensible to say). */
  private async buildContext({ kind, reportId, inq }: {
    kind: NotificationKind; reportId: string; inq: { denyReason: string | null; rawRequest: string; origin: string };
  }): Promise<TemplateContext | null> {
    switch (kind) {
      case NotificationKind.ReportReceived:
        return { reportUrl: this.reportUrl(reportId), request: inq.rawRequest };
      case NotificationKind.QuestionnaireRequest: {
        // HP-27: an email-originated report gets the questions AS AN EMAIL (with a
        // reply address) from the send step — not this web-link notification.
        if (inq.origin === ReportOrigin.Email) return null;
        const q = await this.repo.findQuestionnaireByReport({ reportId });
        if (!q || q.confirmed) return null; // no questionnaire (denied earlier) or already confirmed — don't nag
        return { questionnaireUrl: this.questionnaireUrl(q.token), expiresAt: q.expiresAt };
      }
      case NotificationKind.ReportReady:
      case NotificationKind.ReportUpdated:
        return { reportUrl: this.reportUrl(reportId), ...(await this.reportDetails({ reportId })) };
      default:
        return { reason: inq.denyReason ?? undefined };
    }
  }

  /**
   * The details block for delivered/updated emails: summary + top-ranked options.
   * A locked freemium report gets NO details — the email must not leak what the
   * unlock reveals (HP-21) — just the link to the teaser.
   */
  private async reportDetails({ reportId }: { reportId: string }): Promise<Pick<TemplateContext, 'summary' | 'options'>> {
    const snapshot = await this.repo.findSnapshotByReport({ reportId });
    if (!snapshot || (snapshot.freemium && !snapshot.unlocked)) return {};
    const ranked = Array.isArray(snapshot.options) ? (snapshot.options as Record<string, unknown>[]) : [];
    const options: TemplateOption[] = ranked.slice(0, EMAIL_TOP_OPTIONS).map((o) => {
      const name = String(o.subjectProvider ?? '');
      const ref = String(o.ref ?? o.subjectProvider ?? '');
      return {
        name,
        price: typeof o.price === 'number' ? o.price : null,
        currency: typeof o.currency === 'string' ? o.currency : null,
        priceBasis: typeof o.priceBasis === 'string' ? o.priceBasis : null,
        // HP-27: a direct deep link to each option's dossier, so the emailed report is actionable.
        link: name && ref ? this.optionUrl({ reportId, ref }) : null,
      };
    }).filter((o) => o.name);
    return { summary: snapshot.summary, options };
  }

  /** Scheduled sweep: send exactly one expiry reminder per questionnaire within the lead window. */
  private async sweepReminders(): Promise<void> {
    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + this.config.notifications.reminderLeadHours * 3600_000);
      const due = await this.repo.findDueReminders({ now, windowEnd });
      for (const q of due) {
        const email = q.report.customerEmail;
        if (!isReminderDue({ now, expiresAt: q.expiresAt, leadHours: this.config.notifications.reminderLeadHours, filledAt: null, reminderSentAt: null })) continue;
        if (await this.optedOut(email)) continue;
        if ((await this.repo.claimReminder({ id: q.id })) !== 1) continue; // someone else claimed it
        const { subject, body } = renderNotification({ kind: NotificationKind.QuestionnaireReminder, ctx: { questionnaireUrl: this.questionnaireUrl(q.token), expiresAt: q.expiresAt } });
        await this.channel.send({ to: email, subject, body });
        void this.usage.recordAction({ reportId: q.reportId, kind: UsageKind.EmailSent }); // cost accounting (HP-15)
        await this.outbox.emit({ type: EventType.NotificationSent, reportId: q.reportId, data: { kind: NotificationKind.QuestionnaireReminder, to: email } });
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

  private reportUrl(reportId: string): string {
    return `${this.config.webBaseUrl}/#/r/${reportId}`; // capability webview (by report id, HP-08)
  }
  private optionUrl({ reportId, ref }: { reportId: string; ref: string }): string {
    return `${this.config.webBaseUrl}/#/d/${reportId}/${encodeURIComponent(ref)}`; // per-option dossier deep link (HP-27)
  }
  private questionnaireUrl(token: string): string {
    return `${this.config.webBaseUrl}/#/q/${token}`; // capability-token link into the web app
  }
}

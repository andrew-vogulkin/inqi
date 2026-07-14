import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../infra/config/config.service';
import { CustomerService } from '../customer/customer.service';
import { CreditsService } from '../credits/credits.service';
import { ReportService } from '../report/report.service';
import { MAIL_PROVIDER, MailKind, MailProvider } from '../source/mail.provider';

/** Acknowledgement returned for an inbound email that started a new report (HP-27). */
export interface IntakeAck {
  intake: true;
  reportId: string;
  ref: string | null;
  /** The sender didn't clear the credit gate — no account touched, no report, no pipeline. */
  refused?: boolean;
}

/** One refusal reply per sender per this window — the intake address must not become a spam reflector. */
const REFUSAL_REPLY_COOLDOWN_MS = 24 * 3600_000;

/**
 * HP-27 — email intake: an inbound email TO the configured intake address starts a
 * brand-new report owned by the sender, which then runs autopilot (auto-answered
 * questionnaire) and delivers back over email. The raw request's own compliance gate
 * runs in pre-research, exactly like a web submit — nothing is trusted here.
 *
 * Email intake is UNAUTHENTICATED: anyone who knows the address can make us spend
 * tokens. So the sender's CREDIT BALANCE is the authorization — only an existing
 * customer holding at least {@link ConfigService.intakeMinCredits} gets a run. A
 * stranger is refused without an account ever being created, and the freemium
 * free-report slot is never handed out over email.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);
  /** Last refusal reply per sender — bounds outbound mail to any single address. */
  private readonly refusedAt = new Map<string, number>();

  constructor(
    private readonly customers: CustomerService,
    private readonly reports: ReportService,
    private readonly config: ConfigService,
    private readonly credits: CreditsService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {}

  /** True iff this address IS one of the intake mailboxes (case-insensitive, full address). */
  isIntakeAddress(toAddr?: string): boolean {
    if (!toAddr) return false;
    const addr = toAddr.trim().toLowerCase();
    return this.config.intakeAddresses.includes(addr);
  }

  /**
   * Was this inbound addressed to the intake mailbox on ANY of its recipient addresses?
   * The intake mailbox lives on a mail host that FORWARDS into the webhook (Google
   * Workspace → Postmark inbound), and forwarding rewrites the delivered address — so
   * matching only the delivered address would miss every real intake email. The address
   * the sender actually typed survives in the To/Delivered-To headers.
   */
  isIntake({ toAddr, recipients }: { toAddr?: string; recipients?: string[] }): boolean {
    return [toAddr, ...(recipients ?? [])].some((a) => this.isIntakeAddress(a));
  }

  /**
   * Create a report from an inbound intake email — but only for a sender who already
   * holds enough credits to pay for it. The sender is never enrolled by the attempt
   * itself: an unknown address is looked up, not upserted, so emailing us cannot create
   * an account (nor consume the freemium free report).
   */
  async createReportFromEmail({ fromAddr, subject, body }: { fromAddr?: string; subject?: string; body: string }): Promise<IntakeAck> {
    const email = (fromAddr ?? '').trim().toLowerCase();
    if (!email) {
      // No sender to own the report — nothing we can safely do with it.
      throw new Error('intake email has no From address');
    }

    const min = this.config.intakeMinCredits;
    const customer = await this.customers.findByEmail({ email }); // look up, do NOT create
    const balance = customer ? await this.credits.balance({ customerId: customer.id }) : 0;
    if (balance < min) {
      this.logger.warn(`email intake REFUSED for ${email}: ${customer ? `${balance} credit(s)` : 'no account'} < ${min} required`);
      await this.replyRefused({ email, balance, min, known: !!customer });
      return { intake: true, reportId: '', ref: null, refused: true };
    }

    // Subject carries intent ("Need a wedding photographer…"); fold it in front of the body.
    const rawRequest = [subject?.trim(), body?.trim()].filter(Boolean).join('\n\n') || subject || body || '';
    const report = await this.reports.createFromEmail({ rawRequest, customer: { id: customer!.id, email: customer!.email } });
    this.logger.log(`email intake → report ${report.ref ?? report.id} for ${email} (balance ${balance})`);
    return { intake: true, reportId: report.id, ref: report.ref };
  }

  /**
   * Tell a refused sender why, at most once per {@link REFUSAL_REPLY_COOLDOWN_MS}. The
   * cooldown matters: without it, anyone could point a mail loop at the intake address
   * and have us emit an outbound email per inbound one.
   */
  private async replyRefused({ email, balance, min, known }: { email: string; balance: number; min: number; known: boolean }): Promise<void> {
    const last = this.refusedAt.get(email) ?? 0;
    const now = Date.now();
    if (now - last < REFUSAL_REPLY_COOLDOWN_MS) {
      this.logger.log(`refusal reply to ${email} suppressed (already told within the cooldown)`);
      return;
    }
    this.refusedAt.set(email, now);

    const body = known
      ? [
        `We received your request, but your account doesn't have enough credits to run it.`,
        '',
        `Credits available: ${balance}`,
        `Credits needed:    ${min}`,
        '',
        `Top up here and send your request again: ${this.config.webBaseUrl}/#/credits`,
      ].join('\n')
      : [
        `We received your request, but we couldn't find an inqi account for this email address.`,
        '',
        `Create an account and add credits, then email your request again:`,
        `${this.config.webBaseUrl}`,
      ].join('\n');

    try {
      await this.mail.send({ kind: MailKind.System, to: email, subject: 'We couldn\'t start your inqi report', body });
    } catch (e) {
      // A bounced refusal must never take down inbound processing.
      this.logger.warn(`could not send refusal reply to ${email}: ${(e as Error).message}`);
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../infra/config/config.service';
import { CustomerService } from '../customer/customer.service';
import { CreditsService } from '../credits/credits.service';
import { ReportService } from '../report/report.service';
import { MAIL_PROVIDER, MailKind, MailProvider } from '../source/mail.provider';

/** Why an inbound intake email did not start a report — drives the decline email + logs. */
export const IntakeRefusalReason = {
  NoAccount: 'no_account', // the From address has no inqi account (we never enrol via email)
  AccountSuspended: 'account_suspended', // HP-25: the account exists but is suspended
  InsufficientCredits: 'insufficient_credits', // known account, but balance < intakeMinCredits
} as const;
export type IntakeRefusalReason = (typeof IntakeRefusalReason)[keyof typeof IntakeRefusalReason];

/** Acknowledgement returned for an inbound email that started a new report (HP-27). */
export interface IntakeAck {
  intake: true;
  reportId: string;
  ref: string | null;
  /** The sender didn't clear the gate — no account touched, no report, no pipeline. */
  refused?: boolean;
  /** Present iff refused — the machine-readable reason (also stated in the decline email). */
  reason?: IntakeRefusalReason;
}

/**
 * One DECLINE reply per sender per this window — the intake address must not become a
 * spam reflector (a decline costs nothing to trigger, so it's the abuse vector). An
 * acknowledgement is credit-bounded — each report the sender paid for gets its own — so
 * it is deliberately NOT rate-limited here.
 */
const DECLINE_REPLY_COOLDOWN_MS = 24 * 3600_000;

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
  /** Last DECLINE reply per sender — bounds outbound decline mail to any single address. */
  private readonly declinedAt = new Map<string, number>();

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

    // Gate, in order of severity: no account → suspended → can't pay. Each declines with a
    // stated reason and never touches an account, mints a report, or spends a token.
    if (!customer) return this.decline({ email, reason: IntakeRefusalReason.NoAccount });
    if (customer.suspendedAt) return this.decline({ email, reason: IntakeRefusalReason.AccountSuspended });
    const balance = await this.credits.balance({ customerId: customer.id });
    if (balance < min) return this.decline({ email, reason: IntakeRefusalReason.InsufficientCredits, balance, min });

    // Subject carries intent ("Need a wedding photographer…"); fold it in front of the body.
    const rawRequest = [subject?.trim(), body?.trim()].filter(Boolean).join('\n\n') || subject || body || '';
    const report = await this.reports.createFromEmail({ rawRequest, customer: { id: customer.id, email: customer.email } });
    this.logger.log(`email intake → report ${report.ref ?? report.id} for ${email} (balance ${balance})`);
    await this.acknowledge({ email, reportId: report.id, ref: report.ref });
    return { intake: true, reportId: report.id, ref: report.ref };
  }

  /** Log + email a decline with its reason, then return the refused ack. Never throws. */
  private async decline({ email, reason, balance, min }: { email: string; reason: IntakeRefusalReason; balance?: number; min?: number }): Promise<IntakeAck> {
    this.logger.warn(`email intake DECLINED for ${email}: ${reason}${reason === IntakeRefusalReason.InsufficientCredits ? ` (${balance} < ${min})` : ''}`);
    await this.replyDeclined({ email, reason, balance, min });
    return { intake: true, reportId: '', ref: null, refused: true, reason };
  }

  /**
   * Acknowledge that a report was started — sent once per created report (credit-bounded,
   * so no cooldown). A failed ack must never take down inbound processing.
   */
  private async acknowledge({ email, reportId, ref }: { email: string; reportId: string; ref: string | null }): Promise<void> {
    const label = ref ?? reportId;
    const body = [
      `Thanks — we've started your inqi report${ref ? ` (${ref})` : ''}.`,
      '',
      `Our agents are researching providers and reaching out now. We'll email you the ranked results as they come in — no need to reply.`,
      '',
      `Track it live here: ${this.config.webBaseUrl}/#/r/${reportId}`,
    ].join('\n');
    try {
      await this.mail.send({ kind: MailKind.System, to: email, subject: `We've started your inqi report${ref ? ` — ${ref}` : ''}`, body });
    } catch (e) {
      this.logger.warn(`could not send acknowledgement to ${email} for report ${label}: ${(e as Error).message}`);
    }
  }

  /**
   * Tell a declined sender why, at most once per {@link DECLINE_REPLY_COOLDOWN_MS}. The
   * cooldown matters: a decline is free to trigger, so without it anyone could point a
   * mail loop at the intake address and have us emit an outbound email per inbound one.
   */
  private async replyDeclined({ email, reason, balance, min }: { email: string; reason: IntakeRefusalReason; balance?: number; min?: number }): Promise<void> {
    const last = this.declinedAt.get(email) ?? 0;
    const now = Date.now();
    if (now - last < DECLINE_REPLY_COOLDOWN_MS) {
      this.logger.log(`decline reply to ${email} suppressed (already told within the cooldown)`);
      return;
    }
    this.declinedAt.set(email, now);

    const body = this.declineBody({ reason, balance, min });
    try {
      await this.mail.send({ kind: MailKind.System, to: email, subject: 'We couldn\'t start your inqi report', body });
    } catch (e) {
      // A bounced decline must never take down inbound processing.
      this.logger.warn(`could not send decline reply to ${email}: ${(e as Error).message}`);
    }
  }

  /** The plain-text decline body for each reason — always states WHY and what to do next. */
  private declineBody({ reason, balance, min }: { reason: IntakeRefusalReason; balance?: number; min?: number }): string {
    switch (reason) {
      case IntakeRefusalReason.NoAccount:
        return [
          `We received your request, but we couldn't find an inqi account for this email address.`,
          '',
          `Reason: no account.`,
          '',
          `Create an account and add credits, then email your request again:`,
          `${this.config.webBaseUrl}`,
        ].join('\n');
      case IntakeRefusalReason.AccountSuspended:
        return [
          `We received your request, but your inqi account is currently suspended, so we can't run it.`,
          '',
          `Reason: account suspended.`,
          '',
          `If you think this is a mistake, reply to this email or contact support.`,
        ].join('\n');
      case IntakeRefusalReason.InsufficientCredits:
        return [
          `We received your request, but your account doesn't have enough credits to run it.`,
          '',
          `Reason: not enough credits.`,
          `Credits available: ${balance ?? 0}`,
          `Credits needed:    ${min ?? 0}`,
          '',
          `Top up here and send your request again: ${this.config.webBaseUrl}/#/credits`,
        ].join('\n');
    }
  }
}

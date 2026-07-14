import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../infra/config/config.service';
import { ErrorCode, UpstreamError } from '../../common/errors';

/**
 * Who an email is for. Decides two things: the `From` identity it's sent under,
 * and whether the beta recipient lock ({@link OUTBOUND_TO_OVERRIDE}) applies.
 */
export enum MailKind {
  /**
   * Sign-in codes and customer-facing mail (questionnaire, report ready, reminders).
   * Sent from `systemFrom`, and delivered to the REAL recipient — a sign-in code
   * redirected to someone else is a code nobody can use.
   */
  System = 'system',
  /**
   * Vendor / subject-provider outreach. Sent from `outreachFrom` (the agent's
   * persona) and, during the beta, redirected to {@link OUTBOUND_TO_OVERRIDE} so
   * we never cold-email a real vendor by accident.
   */
  Outreach = 'outreach',
}

export interface SendMailArgs {
  /** Audience — selects the From identity and whether the beta recipient lock applies. */
  kind: MailKind;
  to?: string | null;
  /** Reply-To: the per-thread / per-questionnaire capability address a reply must land on. */
  replyTo?: string;
  subject: string;
  body: string;
  /** Message-ID this email replies to (RFC 5322 In-Reply-To). */
  inReplyTo?: string;
  /** Full chain of Message-IDs (RFC 5322 References). */
  references?: string[];
}

export interface SendMailResult {
  /** The Message-ID assigned to the sent email (for threading + idempotency). */
  externalId: string;
}

/**
 * Swappable email transport. Bind a concrete impl to {@link MAIL_PROVIDER};
 * inject by token so Postmark → SES/Resend (or the local capture provider) is a
 * one-line change.
 */
export interface MailProvider {
  send(args: SendMailArgs): Promise<SendMailResult>;
}
export const MAIL_PROVIDER = Symbol('MailProvider');

const POSTMARK_ENDPOINT = 'https://api.postmarkapp.com/email';

/**
 * Beta pin: never cold-email a real vendor. Every {@link MailKind.Outreach} email is
 * redirected to this single inbox; the intended recipient is preserved in the subject
 * prefix + an `X-Original-To` header so redirected mail stays traceable, and the
 * per-thread `ReplyTo` is untouched so reply threading still works. Set to '' to let
 * outreach reach real vendors. (Mirrors the FORCED_PERSONA_ID Marlowe pin.)
 *
 * Deliberately does NOT apply to {@link MailKind.System} mail — a sign-in code or a
 * finished report redirected away from the customer is useless to them.
 */
export const OUTBOUND_TO_OVERRIDE: string = 'andrei@monkeycode.io';

/**
 * Postmark mail provider. Sends via the Postmark API with `ReplyTo` set to the
 * per-thread reply address so a subject provider's reply lands on the inbound
 * parse webhook (POST /api/comms/inbound). Failures surface as MAIL_SEND_FAILED.
 */
@Injectable()
export class PostmarkMailProvider implements MailProvider {
  private readonly logger = new Logger(PostmarkMailProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(args: SendMailArgs): Promise<SendMailResult> {
    const { token, systemFrom, outreachFrom } = this.config.postmark;
    if (!token) {
      throw new UpstreamError({ code: ErrorCode.MailSendFailed, message: 'Postmark token not configured', retryable: false });
    }
    // Each kind sends under its own verified sender signature.
    const from = args.kind === MailKind.Outreach ? outreachFrom : systemFrom;

    const headers: Array<{ Name: string; Value: string }> = [];
    if (args.inReplyTo) headers.push({ Name: 'In-Reply-To', Value: args.inReplyTo });
    if (args.references?.length) headers.push({ Name: 'References', Value: args.references.join(' ') });

    // The beta recipient pin applies to vendor outreach ONLY — system mail (sign-in
    // codes, questionnaires, delivered reports) must reach the actual person.
    const pin = args.kind === MailKind.Outreach ? OUTBOUND_TO_OVERRIDE : '';
    const intendedTo = args.to ?? null;
    const redirected = pin !== '' && intendedTo !== pin;
    const to = pin || intendedTo;
    const subject = redirected && intendedTo ? `[→ ${intendedTo}] ${args.subject}` : args.subject;
    if (redirected && intendedTo) headers.push({ Name: 'X-Original-To', Value: intendedTo });

    try {
      const res = await fetch(POSTMARK_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': token },
        body: JSON.stringify({
          From: from,
          To: to,
          // Replies route to the per-thread/questionnaire inbound address, when there is one.
          ...(args.replyTo ? { ReplyTo: args.replyTo } : {}),
          Subject: subject,
          TextBody: args.body,
          ...(headers.length ? { Headers: headers } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string };
      if (!res.ok || (data.ErrorCode != null && data.ErrorCode !== 0)) {
        throw new UpstreamError({ code: ErrorCode.MailSendFailed, message: `Postmark send failed: ${data.Message ?? `HTTP ${res.status}`}`, retryable: true });
      }
      this.logger.log(redirected
        ? `sent via Postmark (MessageID ${data.MessageID}) from ${from} → ${to} (redirected from ${intendedTo ?? 'n/a'}; ${args.kind} beta pin)`
        : `sent via Postmark (MessageID ${data.MessageID}) from ${from} to ${to ?? 'n/a'} (${args.kind})`);
      return { externalId: `<${data.MessageID}@inqi>` };
    } catch (e) {
      if (e instanceof UpstreamError) throw e;
      throw new UpstreamError({ code: ErrorCode.MailSendFailed, message: `Postmark send failed: ${(e as Error).message}`, retryable: true });
    }
  }
}

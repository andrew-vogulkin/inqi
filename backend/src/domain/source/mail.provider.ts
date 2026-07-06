import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../infra/config/config.service';
import { ErrorCode, UpstreamError } from '../../common/errors';

export interface SendMailArgs {
  from: string;
  to?: string | null;
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
 * TEMPORARY (Postmark approval window). The server is not yet approved, so Postmark
 * only delivers to recipients on the verified sender domain (@monkeycode.io). Until
 * approval, redirect EVERY outbound recipient (vendor outreach AND customer
 * notifications) to this single same-domain inbox. The intended recipient is
 * preserved in the subject prefix + an `X-Original-To` header so redirected mail
 * stays traceable, and per-thread `ReplyTo` is untouched so reply threading still
 * works. Set to '' to lift the pin once Postmark approves the server.
 * (Mirrors the FORCED_PERSONA_ID Marlowe pin — same go-live, same removal.)
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
    const { token, fromAddress } = this.config.postmark;
    if (!token) {
      throw new UpstreamError({ code: ErrorCode.MailSendFailed, message: 'Postmark token not configured', retryable: false });
    }

    const headers: Array<{ Name: string; Value: string }> = [];
    if (args.inReplyTo) headers.push({ Name: 'In-Reply-To', Value: args.inReplyTo });
    if (args.references?.length) headers.push({ Name: 'References', Value: args.references.join(' ') });

    // Postmark approval window: force every recipient to the same-domain inbox and
    // keep the intended recipient visible (subject tag + X-Original-To header).
    const intendedTo = args.to ?? null;
    const redirected = OUTBOUND_TO_OVERRIDE !== '' && intendedTo !== OUTBOUND_TO_OVERRIDE;
    const to = OUTBOUND_TO_OVERRIDE || intendedTo;
    const subject = redirected && intendedTo ? `[→ ${intendedTo}] ${args.subject}` : args.subject;
    if (redirected && intendedTo) headers.push({ Name: 'X-Original-To', Value: intendedTo });

    try {
      const res = await fetch(POSTMARK_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': token },
        body: JSON.stringify({
          From: fromAddress,
          To: to,
          ReplyTo: args.from, // replies route to the per-thread inbound address
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
        ? `sent via Postmark (MessageID ${data.MessageID}) → ${to} (redirected from ${intendedTo ?? 'n/a'}; approval-window pin)`
        : `sent via Postmark (MessageID ${data.MessageID}) to ${to ?? 'n/a'}`);
      return { externalId: `<${data.MessageID}@inqi>` };
    } catch (e) {
      if (e instanceof UpstreamError) throw e;
      throw new UpstreamError({ code: ErrorCode.MailSendFailed, message: `Postmark send failed: ${(e as Error).message}`, retryable: true });
    }
  }
}

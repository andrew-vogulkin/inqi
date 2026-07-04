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

    try {
      const res = await fetch(POSTMARK_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': token },
        body: JSON.stringify({
          From: fromAddress,
          To: args.to,
          ReplyTo: args.from, // replies route to the per-thread inbound address
          Subject: args.subject,
          TextBody: args.body,
          ...(headers.length ? { Headers: headers } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string };
      if (!res.ok || (data.ErrorCode != null && data.ErrorCode !== 0)) {
        throw new UpstreamError({ code: ErrorCode.MailSendFailed, message: `Postmark send failed: ${data.Message ?? `HTTP ${res.status}`}`, retryable: true });
      }
      this.logger.log(`sent via Postmark (MessageID ${data.MessageID}) to ${args.to ?? 'n/a'}`);
      return { externalId: `<${data.MessageID}@inqi>` };
    } catch (e) {
      if (e instanceof UpstreamError) throw e;
      throw new UpstreamError({ code: ErrorCode.MailSendFailed, message: `Postmark send failed: ${(e as Error).message}`, retryable: true });
    }
  }
}

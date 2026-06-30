import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ModelTier } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { simulatedReplySystem } from '../../infra/ai/prompts';
import { MailProvider, SendMailArgs, SendMailResult } from './mail.provider';

const REPLY_DELAY_MS = 1500;

/**
 * Local mail transport for development/testing. Captures each outbound email to a
 * JSON file under `LOCAL_MAIL_DIR` (nothing leaves the machine), and — when
 * SIMULATE_REPLIES is on — loops a subject-provider reply back through the *real*
 * inbound webhook (POST /api/comms/inbound), so end-to-end tests exercise the
 * full send→inbound path (guard + DTO + mapping + reply loop), not a shortcut.
 * Bound to the `MAIL_PROVIDER` token when `mailDriver` is `local`.
 */
@Injectable()
export class LocalMailProvider implements MailProvider {
  private readonly logger = new Logger(LocalMailProvider.name);
  /** In-memory log of captured emails (most recent last) for inspection in tests. */
  readonly sent: Array<SendMailArgs & SendMailResult> = [];
  /** Reply addresses already auto-replied to — keeps the loopback from looping. */
  private readonly replied = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async send(args: SendMailArgs): Promise<SendMailResult> {
    const externalId = `<${randomUUID()}@inqi.local>`;
    const record = { ...args, externalId };
    this.sent.push(record);
    this.capture(record);

    if (this.config.simulateReplies && args.from && !this.replied.has(args.from)) {
      this.replied.add(args.from);
      setTimeout(() => {
        void this.deliverReply({ replyAddress: args.from, subject: args.subject, inReplyTo: externalId, outreachBody: args.body });
      }, REPLY_DELAY_MS);
    }
    return { externalId };
  }

  private capture(record: SendMailArgs & SendMailResult): void {
    const dir = this.config.localMailDir;
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.json`);
      writeFileSync(file, JSON.stringify(record, null, 2));
      this.logger.log(`captured email → ${file} (to: ${record.to ?? 'n/a'}, subject: ${record.subject})`);
    } catch (e) {
      this.logger.warn(`could not write captured email to ${dir}: ${(e as Error).message}`);
    }
  }

  /** Generate a realistic provider reply (local-currency quote) for the parser to read. */
  private async simulatedReply(outreachBody: string): Promise<string> {
    try {
      const text = await this.ai.complete({ system: simulatedReplySystem(), user: outreachBody.slice(0, 1800), tier: ModelTier.Breadth });
      if (text.trim()) return text.trim();
    } catch (e) {
      this.logger.warn(`simulated reply generation failed, using fallback: ${(e as Error).message}`);
    }
    return `Yes, we can help. Our rate is around ${100 + Math.floor(Math.random() * 900)} USD, available with a 1-2 week lead time.`;
  }

  /** Loop a Postmark-shaped subject-provider reply back through the inbound webhook. */
  private async deliverReply({ replyAddress, subject, inReplyTo, outreachBody }: { replyAddress: string; subject: string; inReplyTo: string; outreachBody: string }): Promise<void> {
    const url = `${this.config.publicBaseUrl}/api/comms/inbound`;
    const id = randomUUID();
    const payload = {
      From: 'sales@provider.example',
      To: replyAddress,
      OriginalRecipient: replyAddress,
      Subject: `Re: ${subject}`,
      TextBody: await this.simulatedReply(outreachBody),
      MessageID: id,
      Headers: [
        { Name: 'Message-ID', Value: `<${id}@provider.example>` },
        { Name: 'In-Reply-To', Value: inReplyTo },
      ],
    };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const { user, pass } = this.config.webhookInboundAuth;
    if (user || pass) headers.authorization = `Basic ${Buffer.from(`${user ?? ''}:${pass ?? ''}`).toString('base64')}`;

    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
      this.logger.log(`loopback reply → ${url} (${res.status}) for ${replyAddress}`);
    } catch (e) {
      this.logger.warn(`loopback reply to ${url} failed: ${(e as Error).message}`);
    }
  }
}

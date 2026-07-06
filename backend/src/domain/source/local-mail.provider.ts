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
/** Loopback replies per thread: enough for the agent's follow-ups, bounded so reply→follow-up→reply can never loop unbounded. */
const REPLY_MAX_PER_THREAD = 3;

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
  /** Loopback replies sent per reply address — follow-ups get answered too, but bounded (no infinite loop). */
  private readonly replyCount = new Map<string, number>();
  /** Reply addresses whose simulated provider never answers (rolled once, on first contact — silence is sticky). */
  private readonly ignoring = new Set<string>();
  /**
   * Per-thread transcript (customer emails + our simulated replies). Without it the
   * role-play model only sees the latest follow-up ("can you confirm the price?")
   * and hallucinates a fresh context — observed: a Portugal surf thread answered
   * with a Bangkok THB quote.
   */
  private readonly transcript = new Map<string, string[]>();

  constructor(
    private readonly config: ConfigService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async send(args: SendMailArgs): Promise<SendMailResult> {
    const externalId = `<${randomUUID()}@inqi.local>`;
    const record = { ...args, externalId };
    this.sent.push(record);
    this.capture(record);

    if (this.config.simulateReplies && args.from && !this.isIgnoring(args.from)) {
      const thread = this.transcript.get(args.from) ?? [];
      thread.push(`CUSTOMER: ${args.body}`);
      this.transcript.set(args.from, thread);
      const sentSoFar = this.replyCount.get(args.from) ?? 0;
      if (sentSoFar < REPLY_MAX_PER_THREAD) {
        this.replyCount.set(args.from, sentSoFar + 1);
        // Round N of SIMULATE_REPLY_ROUNDS: early rounds withhold the quote (one
        // clarifying question), the final round quotes in full.
        const complete = sentSoFar + 1 >= this.config.simulateReplyRounds;
        setTimeout(() => {
          void this.deliverReply({ replyAddress: args.from, subject: args.subject, inReplyTo: externalId, complete });
        }, REPLY_DELAY_MS);
      }
    }
    return { externalId };
  }

  /**
   * Does this simulated provider ignore the email? Rolled once on first contact
   * (per SIMULATE_REPLY_IGNORE_RATE) and sticky — a silent provider stays silent
   * for follow-ups too, so the reply-timeout reaper path gets exercised for real.
   */
  private isIgnoring(replyAddress: string): boolean {
    if (this.ignoring.has(replyAddress)) return true;
    if (this.replyCount.has(replyAddress)) return false; // already engaged — keeps replying
    if (Math.random() < this.config.simulateReplyIgnoreRate) {
      this.ignoring.add(replyAddress);
      this.logger.log(`simulating a provider who never replies (${replyAddress})`);
      return true;
    }
    return false;
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

  /**
   * Generate a realistic provider reply (local-currency quote, or a clarifying
   * question on early rounds). The model sees the WHOLE thread so a follow-up
   * gets answered in the same context (service, location, currency) it started in.
   */
  private async simulatedReply({ replyAddress, complete }: { replyAddress: string; complete: boolean }): Promise<string> {
    const thread = (this.transcript.get(replyAddress) ?? []).join('\n\n').slice(-4000);
    try {
      const text = await this.ai.complete({ system: simulatedReplySystem({ complete }), user: thread, tier: ModelTier.Breadth });
      if (text.trim()) {
        const threadSoFar = this.transcript.get(replyAddress) ?? [];
        threadSoFar.push(`YOU (provider): ${text.trim()}`);
        this.transcript.set(replyAddress, threadSoFar);
        return text.trim();
      }
    } catch (e) {
      this.logger.warn(`simulated reply generation failed, using fallback: ${(e as Error).message}`);
    }
    if (!complete) return 'Thanks for reaching out — yes, we offer this. Could you let me know which dates you have in mind?';
    return `Yes, we can help. Our rate is around ${100 + Math.floor(Math.random() * 900)} USD, available with a 1-2 week lead time.`;
  }

  /** Loop a Postmark-shaped subject-provider reply back through the inbound webhook. */
  private async deliverReply({ replyAddress, subject, inReplyTo, complete }: { replyAddress: string; subject: string; inReplyTo: string; complete: boolean }): Promise<void> {
    const url = `${this.config.publicBaseUrl}/api/comms/inbound`;
    const id = randomUUID();
    const payload = {
      From: 'sales@provider.example',
      To: replyAddress,
      OriginalRecipient: replyAddress,
      Subject: `Re: ${subject}`,
      TextBody: await this.simulatedReply({ replyAddress, complete }),
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

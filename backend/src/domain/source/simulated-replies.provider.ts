import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ModelTier } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { AiProvider } from '../../infra/ai/ai.tokens';
import { simulatedReplySystem } from '../../infra/ai/prompts';
import { MailKind, MailProvider, SendMailArgs, SendMailResult } from './mail.provider';

const REPLY_DELAY_MS = 1500;
/** Loopback replies per thread: enough for the agent's follow-ups, bounded so reply→follow-up→reply can never loop unbounded. */
const REPLY_MAX_PER_THREAD = 3;

/**
 * SIMULATE_REPLIES as a decorator over ANY mail transport (Postmark or local).
 * The wrapped provider really sends the email (with OUTBOUND_TO_OVERRIDE pinning
 * outreach to a safe inbox); this layer then role-plays the subject provider and
 * loops the reply back through the *real* inbound webhook (POST /api/comms/inbound),
 * so demo/e2e runs exercise the full send→inbound path (guard + DTO + mapping +
 * reply loop), not a shortcut. Constructed by the MAIL_PROVIDER factory when
 * `simulateReplies` is on — previously this lived inside LocalMailProvider, which
 * made SIMULATE_REPLIES silently dead under MAIL_DRIVER=postmark.
 */
export class SimulatedRepliesMailProvider implements MailProvider {
  private readonly logger = new Logger(SimulatedRepliesMailProvider.name);
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
    private readonly inner: MailProvider,
    private readonly config: ConfigService,
    private readonly ai: AiProvider,
  ) {}

  async send(args: SendMailArgs): Promise<SendMailResult> {
    const result = await this.inner.send(args);

    // Only VENDOR outreach gets a role-played reply. System mail (sign-in codes,
    // questionnaires, delivered reports) also carries a replyTo, and simulating a
    // "provider" answer to a customer's questionnaire address would be nonsense.
    const replyAddress = args.kind === MailKind.Outreach ? args.replyTo : undefined;
    if (replyAddress && !this.isIgnoring(replyAddress)) {
      const thread = this.transcript.get(replyAddress) ?? [];
      thread.push(`CUSTOMER: ${args.body}`);
      this.transcript.set(replyAddress, thread);
      const sentSoFar = this.replyCount.get(replyAddress) ?? 0;
      if (sentSoFar < REPLY_MAX_PER_THREAD) {
        this.replyCount.set(replyAddress, sentSoFar + 1);
        // Round N of SIMULATE_REPLY_ROUNDS: early rounds withhold the quote (one
        // clarifying question), the final round quotes in full.
        const complete = sentSoFar + 1 >= this.config.simulateReplyRounds;
        setTimeout(() => {
          void this.deliverReply({ replyAddress, subject: args.subject, inReplyTo: result.externalId, complete });
        }, REPLY_DELAY_MS);
      }
    }
    return result;
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

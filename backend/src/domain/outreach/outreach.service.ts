import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { InquiryMessage } from '@prisma/client';
import { ComplianceKind, EventType, MessageDirection, MessageStatus, ModelTier, ReviewStatus, SubtaskStatus, UsageKind } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ConfigService } from '../../infra/config/config.service';
import { UsageService } from '../../infra/usage/usage.service';
import { AI_PROVIDER, AiProvider, ChatMsg, ChatRole } from '../../infra/ai/ai.tokens';
import { ErrorCode, NotFoundError } from '../../common/errors';
import { COMPLIANCE_SCORER, ComplianceScorer } from '../compliance/compliance.tokens';
import { getPersona, pickPersona } from '../agent/personas';
import { MAIL_PROVIDER, MailProvider } from './mail.provider';
import { OutreachRepository } from './outreach.repository';

export interface ComposeResult {
  blocked: boolean;
  replyAddress?: string;
  personaId?: string;
}

export interface IngestResult {
  duplicate: boolean;
  inquiryId: string;
  subtaskId: string;
  message: InquiryMessage;
}

/**
 * The agent communication track: composing, sending and receiving subject-
 * provider email. Owns the InquiryMessage store, per-thread reply addresses and
 * the MailProvider. Subtask *status* mutations belong to the agent — this
 * service only returns what it produced.
 */
@Injectable()
export class OutreachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outreach: OutreachRepository,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    @Inject(COMPLIANCE_SCORER) private readonly compliance: ComplianceScorer,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly usage: UsageService,
  ) {}

  /** Unique inbound address so a reply maps back to exactly one subtask thread. */
  replyAddressFor({ token }: { token: string }): string {
    return `${token}@${this.config.inboundDomain}`;
  }

  /** Chat-format chain for the model: oldest→newest, our msgs as assistant, theirs as user. */
  async buildChain({ subtaskId }: { subtaskId: string }): Promise<ChatMsg[]> {
    const msgs = await this.outreach.listThread({ subtaskId });
    return msgs.map((m) => ({
      role: m.direction === MessageDirection.Outbound ? ChatRole.Assistant : ChatRole.User,
      content: `Subject: ${m.subject ?? ''}\n${m.body}`,
    }));
  }

  /** Compact epic memory: shared phrasing + what worked / failed on sibling subtasks. */
  async epicContext({ epicId }: { epicId: string }): Promise<string> {
    const epic = await this.outreach.findEpicWithSubtasks({ epicId });
    const qualified = epic.subtasks
      .filter((s) => s.status === SubtaskStatus.Qualified)
      .map((s) => `${s.subjectProviderName}: ${JSON.stringify(s.result)}`);
    const failed = epic.subtasks.filter((s) => s.status === SubtaskStatus.Failed).map((s) => s.subjectProviderName);
    return `Shared context: ${JSON.stringify(epic.sharedContext)}\nSuccessful cases: ${qualified.join(' | ') || 'none yet'}\nFailed subject providers: ${failed.join(', ') || 'none'}`;
  }

  /** Draft + compliance-gate + send the first inquiry email for a subtask (DEPTH model drafts it). */
  async composeAndSend({ inquiryId, subtaskId }: { inquiryId: string; subtaskId: string }): Promise<ComposeResult> {
    // Idempotency: a retried OutreachSubtask must not send a second opening email.
    const already = await this.outreach.findFirstOutbound({ subtaskId });
    if (already) {
      return { blocked: false, replyAddress: already.fromAddr ?? undefined, personaId: already.personaId ?? undefined };
    }
    const st = await this.outreach.findSubtask({ id: subtaskId });
    const contact = (st.contact ?? {}) as { country?: string; region?: string; email?: string };
    const persona = st.personaId ? getPersona({ id: st.personaId }) : pickPersona({ regionHint: contact.country ?? contact.region ?? null });
    const token = randomBytes(16).toString('hex');
    const replyAddress = this.replyAddressFor({ token });
    const subject = await this.outreach.findSubjectByEpic({ epicId: st.epicId });

    // DEPTH draft in this persona's voice. TODO real call:
    //   const system = personaSystem({ persona, task: 'Write the first outreach email.' });
    //   const body = await this.ai.chat({ messages: [{ role: ChatRole.System, content: system + '\n' + ctx }, ...], tier: ModelTier.Depth });
    const body = `Hello ${st.subjectProviderName},\n\nWe're researching: ${subject?.title ?? 'an item/service'}.\nCould you share price, availability and lead time?\n\nWarm regards,\n${persona.name}\nInqi Tech Service Provider`;

    const review = await this.compliance.score({ kind: ComplianceKind.Email, text: body }); // ethical+legal gate before send
    if (review.status === ReviewStatus.Blocked) {
      // Persist the blocked draft (never sent) so the compliance block is auditable (HP-14).
      await this.outreach.createMessage({
        data: {
          subtaskId, direction: MessageDirection.Outbound, status: MessageStatus.Draft,
          fromAddr: replyAddress, toAddr: contact.email ?? null, subject: `Inquiry: ${subject?.title ?? ''}`,
          body, personaId: persona.id, reviewStatus: review.status, riskScore: review.score, riskTags: review.categories,
        },
      });
      return { blocked: true };
    }

    const { externalId } = await this.mail.send({
      from: replyAddress,
      to: contact.email ?? null,
      subject: `Inquiry: ${subject?.title ?? ''}`,
      body,
    });
    // The sent-message record + its realtime event commit together (send already
    // happened above; the durable record is what makes a retry idempotent).
    await this.prisma.$transaction(async (tx) => {
      const m = await this.outreach.createMessage({
        data: {
          subtaskId, direction: MessageDirection.Outbound, status: MessageStatus.Sent,
          fromAddr: replyAddress, toAddr: contact.email ?? null, subject: `Inquiry: ${subject?.title ?? ''}`,
          body, externalId, references: [externalId], modelTier: ModelTier.Depth,
          personaId: persona.id, reviewStatus: review.status, riskScore: review.score, riskTags: review.categories,
        },
        tx,
      });
      await this.outbox.emit({ type: EventType.MessageSent, inquiryId, epicId: st.epicId, subtaskId, data: { to: m.toAddr, replyAddress }, tx });
    });
    void this.usage.recordAction({ inquiryId, kind: UsageKind.EmailSent }); // cost accounting (HP-15)
    // Replies arrive via the inbound webhook (real provider, or the local provider's loopback).
    return { blocked: false, replyAddress, personaId: persona.id };
  }

  /** Send a follow-up email in an existing thread (same persona). */
  async sendFollowup({ inquiryId, subtaskId, body }: { inquiryId: string; subtaskId: string; body?: string }): Promise<void> {
    const st = await this.outreach.findSubtask({ id: subtaskId });
    const persona = getPersona({ id: st.personaId });
    const text = `${body ?? 'Thanks — one follow-up: can you confirm the price including delivery?'}\n\n${persona.name}`;
    const { externalId } = await this.mail.send({ from: st.replyAddress ?? '', to: null, subject: 'Re: inquiry', body: text });
    await this.prisma.$transaction(async (tx) => {
      await this.outreach.createMessage({
        data: {
          subtaskId, direction: MessageDirection.Outbound, status: MessageStatus.Sent, subject: 'Re: inquiry',
          body: text, externalId, references: [externalId], modelTier: ModelTier.Depth, personaId: persona.id,
        },
        tx,
      });
      await this.outbox.emit({ type: EventType.MessageSent, inquiryId, epicId: st.epicId, subtaskId, data: { followup: true }, tx });
    });
  }

  /** Persist an inbound subject-provider email and emit message.received. Idempotent on Message-ID. */
  async ingestInbound(p: { toAddr: string; fromAddr?: string; subject?: string; body: string; externalId?: string; inReplyTo?: string; references?: string[] }): Promise<IngestResult> {
    const token = p.toAddr.split('@')[0];
    const st = await this.outreach.findSubtaskByReplyAddress({ replyAddress: this.replyAddressFor({ token }) });
    if (!st) throw new NotFoundError({ code: ErrorCode.SubtaskThreadNotFound, message: 'no subtask thread for that address' });

    if (p.externalId) {
      const dup = await this.outreach.findMessageByExternalId({ externalId: p.externalId });
      if (dup) return { duplicate: true, inquiryId: st.epic.inquiryId, subtaskId: st.id, message: dup };
    }
    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await this.outreach.createMessage({
        data: {
          subtaskId: st.id, direction: MessageDirection.Inbound, status: MessageStatus.Received,
          fromAddr: p.fromAddr, toAddr: p.toAddr, subject: p.subject, body: p.body,
          externalId: p.externalId, inReplyTo: p.inReplyTo, references: p.references ?? [],
        },
        tx,
      });
      await this.outbox.emit({ type: EventType.MessageReceived, inquiryId: st.epic.inquiryId, epicId: st.epicId, subtaskId: st.id, data: { from: p.fromAddr }, tx });
      return m;
    });
    return { duplicate: false, inquiryId: st.epic.inquiryId, subtaskId: st.id, message: msg };
  }
}

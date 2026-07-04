import { Inject, Injectable } from '@nestjs/common';
import type { Message } from '@prisma/client';
import { ComplianceKind, EventType, MessageDirection, MessageStatus, ModelTier, ReviewStatus, InquiryStatus, UsageKind } from '@inqi/shared';
import { OutboxService } from '../../infra/events/outbox.service';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { ConfigService } from '../../infra/config/config.service';
import { UsageService } from '../../infra/usage/usage.service';
import { AI_PROVIDER, AiProvider, ChatMsg, ChatRole } from '../../infra/ai/ai.tokens';
import { ErrorCode, NotFoundError } from '../../common/errors';
import { COMPLIANCE_SCORER, ComplianceScorer } from '../compliance/compliance.tokens';
import { getPersona, pickPersona } from '../agent/personas';
import { MAIL_PROVIDER, MailProvider } from './mail.provider';
import { EmailChannelRepository } from './email.repository';
import { SourcesService } from './sources.service';

export interface ComposeResult {
  blocked: boolean;
  replyAddress?: string;
  personaId?: string;
}

export interface IngestResult {
  duplicate: boolean;
  reportId: string;
  inquiryId: string;
  sourceId: string;
  message: Message;
}

/**
 * The email channel of the Source layer: composing, sending and receiving
 * subject-provider email. Every inquiry gets one `email` Source as its thread
 * anchor (reply address + conversation state); Messages hang off that source.
 * Inquiry *status* mutations belong to the agent — this service only returns
 * what it produced.
 */
@Injectable()
export class EmailChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailChannelRepository,
    private readonly sources: SourcesService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    @Inject(COMPLIANCE_SCORER) private readonly compliance: ComplianceScorer,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly usage: UsageService,
  ) {}

  /** Chat-format chain for the model: oldest→newest, our msgs as assistant, theirs as user. */
  async buildChain({ inquiryId }: { inquiryId: string }): Promise<ChatMsg[]> {
    const msgs = await this.emails.listThread({ inquiryId });
    return msgs.map((m) => ({
      role: m.direction === MessageDirection.Outbound ? ChatRole.Assistant : ChatRole.User,
      content: `Subject: ${m.subject ?? ''}\n${m.body}`,
    }));
  }

  /** Compact epic memory: shared phrasing + what worked / failed on sibling inquiries. */
  async epicContext({ epicId }: { epicId: string }): Promise<string> {
    const epic = await this.emails.findEpicWithInquiries({ epicId });
    const qualified = epic.inquiries
      .filter((s) => s.status === InquiryStatus.Qualified)
      .map((s) => `${s.name}: ${JSON.stringify(s.result)}`);
    const failed = epic.inquiries.filter((s) => s.status === InquiryStatus.Failed).map((s) => s.name);
    return `Shared context: ${JSON.stringify(epic.sharedContext)}\nSuccessful cases: ${qualified.join(' | ') || 'none yet'}\nFailed subject providers: ${failed.join(', ') || 'none'}`;
  }

  /** The report's persona (assigned at report create) — every thread of a report speaks with one voice. */
  private async personaFor({ reportId, regionHint }: { reportId: string; regionHint: string | null }) {
    const report = await this.emails.findReport({ id: reportId });
    return report.personaId ? getPersona({ id: report.personaId }) : pickPersona({ regionHint });
  }

  /** Draft + compliance-gate + send the first outreach email for an inquiry (DEPTH model drafts it). */
  async composeAndSend({ reportId, inquiryId }: { reportId: string; inquiryId: string }): Promise<ComposeResult> {
    // Idempotency: a retried OutreachInquiry must not send a second opening email.
    const already = await this.emails.findFirstOutbound({ inquiryId });
    if (already) {
      return { blocked: false, replyAddress: already.fromAddr ?? undefined, personaId: already.personaId ?? undefined };
    }
    const inquiry = await this.emails.findInquiry({ id: inquiryId });
    const contact = (inquiry.contact ?? {}) as { country?: string; region?: string; email?: string };
    const persona = await this.personaFor({ reportId, regionHint: contact.country ?? contact.region ?? null });
    const thread = await this.sources.ensureEmailThread({ inquiryId }); // the Source that anchors this conversation
    const replyAddress = thread.replyAddress as string;
    const subject = await this.emails.findSubjectByEpic({ epicId: inquiry.epicId });

    // DEPTH draft in this persona's voice. TODO real call:
    //   const system = personaSystem({ persona, task: 'Write the first outreach email.' });
    //   const body = await this.ai.chat({ messages: [{ role: ChatRole.System, content: system + '\n' + ctx }, ...], tier: ModelTier.Depth });
    const body = `Hello ${inquiry.name},\n\nWe're researching: ${subject?.title ?? 'an item/service'}.\nCould you share price, availability and lead time?\n\nWarm regards,\n${persona.name}\nInqi Tech Service Provider`;

    const review = await this.compliance.score({ kind: ComplianceKind.Email, text: body }); // ethical+legal gate before send
    if (review.status === ReviewStatus.Blocked) {
      // Persist the blocked draft (never sent) so the compliance block is auditable (HP-14).
      await this.emails.createMessage({
        data: {
          sourceId: thread.id, inquiryId, direction: MessageDirection.Outbound, status: MessageStatus.Draft,
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
      const m = await this.emails.createMessage({
        data: {
          sourceId: thread.id, inquiryId, direction: MessageDirection.Outbound, status: MessageStatus.Sent,
          fromAddr: replyAddress, toAddr: contact.email ?? null, subject: `Inquiry: ${subject?.title ?? ''}`,
          body, externalId, references: [externalId], modelTier: ModelTier.Depth,
          personaId: persona.id, reviewStatus: review.status, riskScore: review.score, riskTags: review.categories,
        },
        tx,
      });
      await this.outbox.emit({ type: EventType.MessageSent, reportId, epicId: inquiry.epicId, inquiryId, data: { to: m.toAddr, replyAddress, sourceId: thread.id }, tx });
    });
    void this.usage.recordAction({ reportId, kind: UsageKind.EmailSent }); // cost accounting (HP-15)
    // Replies arrive via the inbound webhook (real provider, or the local provider's loopback).
    return { blocked: false, replyAddress, personaId: persona.id };
  }

  /** Send a follow-up email in an existing thread (same persona). */
  async sendFollowup({ reportId, inquiryId, body }: { reportId: string; inquiryId: string; body?: string }): Promise<void> {
    const inquiry = await this.emails.findInquiry({ id: inquiryId });
    const thread = await this.sources.findEmailThread({ inquiryId });
    if (!thread) throw new NotFoundError({ code: ErrorCode.InquiryThreadNotFound, message: 'no email thread for that inquiry' });
    const persona = await this.personaFor({ reportId, regionHint: null });
    const text = `${body ?? 'Thanks — one follow-up: can you confirm the price including delivery?'}\n\n${persona.name}`;
    const { externalId } = await this.mail.send({ from: thread.replyAddress ?? '', to: null, subject: 'Re: inquiry', body: text });
    await this.prisma.$transaction(async (tx) => {
      await this.emails.createMessage({
        data: {
          sourceId: thread.id, inquiryId, direction: MessageDirection.Outbound, status: MessageStatus.Sent, subject: 'Re: inquiry',
          body: text, externalId, references: [externalId], modelTier: ModelTier.Depth, personaId: persona.id,
        },
        tx,
      });
      await this.outbox.emit({ type: EventType.MessageSent, reportId, epicId: inquiry.epicId, inquiryId, data: { followup: true, sourceId: thread.id }, tx });
    });
  }

  /** Persist an inbound subject-provider email and emit message.received. Idempotent on Message-ID. */
  async ingestInbound(p: { toAddr: string; fromAddr?: string; subject?: string; body: string; externalId?: string; inReplyTo?: string; references?: string[] }): Promise<IngestResult> {
    const token = p.toAddr.split('@')[0];
    const thread = await this.sources.findThreadByReplyAddress({ replyAddress: `${token}@${this.config.inboundDomain}` });
    if (!thread) throw new NotFoundError({ code: ErrorCode.InquiryThreadNotFound, message: 'no inquiry thread for that address' });
    const { id: inquiryId, reportId, epicId } = thread.inquiry;

    if (p.externalId) {
      const dup = await this.emails.findMessageByExternalId({ externalId: p.externalId });
      if (dup) return { duplicate: true, reportId, inquiryId, sourceId: thread.id, message: dup };
    }
    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await this.emails.createMessage({
        data: {
          sourceId: thread.id, inquiryId, direction: MessageDirection.Inbound, status: MessageStatus.Received,
          fromAddr: p.fromAddr, toAddr: p.toAddr, subject: p.subject, body: p.body,
          externalId: p.externalId, inReplyTo: p.inReplyTo, references: p.references ?? [],
        },
        tx,
      });
      await this.sources.updateThreadState({ sourceId: thread.id, lastInboundAt: m.createdAt, tx });
      await this.outbox.emit({ type: EventType.MessageReceived, reportId, epicId, inquiryId, data: { from: p.fromAddr, sourceId: thread.id }, tx });
      return m;
    });
    return { duplicate: false, reportId, inquiryId, sourceId: thread.id, message: msg };
  }
}

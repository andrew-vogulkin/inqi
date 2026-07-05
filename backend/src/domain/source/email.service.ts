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
import { Persona, getPersona, personaSystem, pickPersona } from '../agent/personas';
import { signEmail } from './email-signature';
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
  /** The inbound failed the compliance gate — persisted for audit, hidden from customer reads; the agent fails the inquiry. */
  blocked: boolean;
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

  /**
   * DEPTH-drafted opening email in the persona's voice, grounded in the confirmed
   * scope (+ any breadth-relaxed constraint the provider must confirm). Falls back
   * to the plain template when AI is unconfigured or the draft fails — an opener
   * must never block outreach.
   */
  private async draftOpening({ persona, inquiryName, epicId, subject, matchNote, channel }: {
    persona: Persona; inquiryName: string; epicId: string;
    subject: { title: string; description: string } | null; matchNote: string | null; channel?: string | null;
  }): Promise<string> {
    // Unsigned — the caller appends the ONE canonical signature block deterministically.
    const fallback = `Hello ${inquiryName},\n\nWe're researching: ${subject?.title ?? 'an item/service'}.\nCould you share price, availability and lead time?`;
    if (!this.ai.isConfigured()) return fallback;
    try {
      const task = [
        `TASK: write the FIRST-CONTACT inquiry email BODY (no subject line) to "${inquiryName}" on behalf of a client.`,
        `The client is looking for: ${subject?.title ?? 'an item/service'}${subject?.description ? ` — ${subject.description}` : ''}.`,
        'THE TARGET OF THIS EMAIL CHAIN is a concrete COST ESTIMATE and a TIMELINE — ask specifically for: the price for exactly this request (in their local currency), availability, lead time, and what is included.',
        channel ? `This email goes to the provider's ${channel.toUpperCase()} contact — angle it accordingly (sales → the quote and what is included; booking → concrete dates, availability and booking terms).` : '',
        matchNote ? `IMPORTANT: this provider was found under a relaxed search — politely ask them to CONFIRM: ${matchNote}.` : '',
        `60-110 words. Do NOT add any sign-off, name or signature — it is appended automatically. Output ONLY the email body — no subject, no commentary.`,
      ].filter(Boolean).join(' ');
      const ctx = await this.epicContext({ epicId }); // shared phrasing + sibling outcomes
      const body = await this.ai.chat({
        messages: [
          { role: ChatRole.System, content: `${personaSystem({ persona, task })}\n${ctx}` },
          { role: ChatRole.User, content: 'Draft the email body now.' },
        ],
        tier: ModelTier.Depth,
      });
      return body?.trim() || fallback;
    } catch {
      return fallback; // a drafting hiccup must never block the outreach wave
    }
  }

  /**
   * Draft + compliance-gate + send the first outreach email for an inquiry (DEPTH
   * model drafts it). A provider with several named contacts (`contact.emails`:
   * sales, booking, …) gets ONE thread per channel, each with its own reply
   * address and a channel-angled draft; otherwise the single default thread.
   */
  async composeAndSend({ reportId, inquiryId }: { reportId: string; inquiryId: string }): Promise<ComposeResult> {
    const inquiry = await this.emails.findInquiry({ id: inquiryId });
    const contact = (inquiry.contact ?? {}) as {
      country?: string; region?: string; email?: string; matchNote?: string;
      emails?: { label?: string | null; email?: string | null }[];
    };
    const persona = await this.personaFor({ reportId, regionHint: contact.country ?? contact.region ?? null });
    const subject = await this.emails.findSubjectByEpic({ epicId: inquiry.epicId });
    const channels = contact.emails?.length
      ? contact.emails.map((e) => ({ label: e.label ?? null, to: e.email ?? null }))
      : [{ label: null, to: contact.email ?? null }];

    let sent: { replyAddress: string } | null = null;
    let anyBlocked = false;
    for (const ch of channels) {
      const thread = await this.sources.ensureEmailThread({ inquiryId, channel: ch.label ?? undefined }); // one Source per channel
      // A compliance-quarantined channel never gets another email.
      if (((thread.data ?? {}) as Record<string, unknown>).blocked) continue;
      const replyAddress = thread.replyAddress as string;
      // Idempotency PER THREAD: a retried OutreachInquiry must not re-send an opener.
      const already = await this.emails.findFirstOutbound({ inquiryId, sourceId: thread.id });
      if (already) { sent = sent ?? { replyAddress }; continue; }

      // DEPTH draft in this persona's voice, grounded in the confirmed scope — so the
      // provider quotes the RIGHT thing (and confirms any breadth-relaxed constraint).
      // The signature is hardcoded (model sign-offs stripped) — one canonical block always.
      const body = signEmail({
        body: await this.draftOpening({
          persona, inquiryName: inquiry.name, epicId: inquiry.epicId,
          subject: subject ? { title: subject.title, description: subject.description } : null,
          matchNote: contact.matchNote ?? null,
          channel: ch.label,
        }),
        personaName: persona.name,
      });
      const mailSubject = `Inquiry: ${subject?.title ?? ''}`;

      const review = await this.compliance.score({ kind: ComplianceKind.Email, text: body }); // ethical+legal gate before send
      if (review.status === ReviewStatus.Blocked) {
        // Persist the blocked draft (never sent) so the compliance block is auditable (HP-14).
        await this.emails.createMessage({
          data: {
            sourceId: thread.id, inquiryId, direction: MessageDirection.Outbound, status: MessageStatus.Draft,
            fromAddr: replyAddress, toAddr: ch.to, subject: mailSubject,
            body, personaId: persona.id, reviewStatus: review.status, riskScore: review.score, riskTags: review.categories,
          },
        });
        anyBlocked = true;
        continue;
      }

      const { externalId } = await this.mail.send({ from: replyAddress, to: ch.to, subject: mailSubject, body });
      // The sent-message record + its realtime event commit together (send already
      // happened above; the durable record is what makes a retry idempotent).
      await this.prisma.$transaction(async (tx) => {
        const m = await this.emails.createMessage({
          data: {
            sourceId: thread.id, inquiryId, direction: MessageDirection.Outbound, status: MessageStatus.Sent,
            fromAddr: replyAddress, toAddr: ch.to, subject: mailSubject,
            body, externalId, references: [externalId], modelTier: ModelTier.Depth,
            personaId: persona.id, reviewStatus: review.status, riskScore: review.score, riskTags: review.categories,
          },
          tx,
        });
        await this.outbox.emit({ type: EventType.MessageSent, reportId, epicId: inquiry.epicId, inquiryId, data: { to: m.toAddr, replyAddress, sourceId: thread.id, channel: ch.label }, tx });
      });
      void this.usage.recordAction({ reportId, kind: UsageKind.EmailSent }); // cost accounting (HP-15)
      sent = sent ?? { replyAddress };
    }
    // Blocked only when NOTHING went out; replies arrive via the inbound webhook
    // (real provider, or the local provider's loopback).
    if (!sent) return { blocked: anyBlocked };
    return { blocked: false, replyAddress: sent.replyAddress, personaId: persona.id };
  }

  /** Send a follow-up email in an existing thread (same persona). `sourceId` pins the channel thread. */
  async sendFollowup({ reportId, inquiryId, sourceId, body }: { reportId: string; inquiryId: string; sourceId?: string; body?: string }): Promise<void> {
    const inquiry = await this.emails.findInquiry({ id: inquiryId });
    const thread = sourceId
      ? await this.sources.findSourceById({ id: sourceId })
      : await this.sources.findEmailThread({ inquiryId });
    if (!thread) throw new NotFoundError({ code: ErrorCode.InquiryThreadNotFound, message: 'no email thread for that inquiry' });
    const persona = await this.personaFor({ reportId, regionHint: null });
    const draft = body ?? 'Thanks — could you share a concrete cost estimate for this request (in your local currency) and the timeline (availability + lead time)?';
    // Hardcoded signature: strip whatever sign-off the model wrote, append the canonical block.
    const text = signEmail({ body: draft, personaName: persona.name });
    // Thread the original subject ("Re: Inquiry: …") — the customer sees these emails verbatim.
    const opener = await this.emails.findFirstOutbound({ inquiryId });
    const subject = opener?.subject ? `Re: ${opener.subject.replace(/^Re:\s*/i, '')}` : 'Re: inquiry';
    const { externalId } = await this.mail.send({ from: thread.replyAddress ?? '', to: null, subject, body: text });
    await this.prisma.$transaction(async (tx) => {
      await this.emails.createMessage({
        data: {
          sourceId: thread.id, inquiryId, direction: MessageDirection.Outbound, status: MessageStatus.Sent, subject,
          body: text, externalId, references: [externalId], modelTier: ModelTier.Depth, personaId: persona.id,
        },
        tx,
      });
      await this.outbox.emit({ type: EventType.MessageSent, reportId, epicId: inquiry.epicId, inquiryId, data: { followup: true, sourceId: thread.id }, tx });
    });
  }

  /**
   * Persist an inbound subject-provider email and emit message.received. Idempotent
   * on Message-ID. Every inbound passes the ethical+legal compliance gate first — a
   * blocked reply is persisted for audit (HP-14) but never announced (no
   * message.received event, hidden from customer reads); the agent layer fails the
   * inquiry on `blocked`.
   */
  async ingestInbound(p: { toAddr: string; fromAddr?: string; subject?: string; body: string; externalId?: string; inReplyTo?: string; references?: string[] }): Promise<IngestResult> {
    const token = p.toAddr.split('@')[0];
    const thread = await this.sources.findThreadByReplyAddress({ replyAddress: `${token}@${this.config.inboundDomain}` });
    if (!thread) throw new NotFoundError({ code: ErrorCode.InquiryThreadNotFound, message: 'no inquiry thread for that address' });
    const { id: inquiryId, reportId, epicId } = thread.inquiry;

    if (p.externalId) {
      const dup = await this.emails.findMessageByExternalId({ externalId: p.externalId });
      if (dup) return { duplicate: true, blocked: dup.reviewStatus === ReviewStatus.Blocked, reportId, inquiryId, sourceId: thread.id, message: dup };
    }
    const review = await this.compliance.score({ kind: ComplianceKind.Email, text: p.body });
    const blocked = review.status === ReviewStatus.Blocked;
    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await this.emails.createMessage({
        data: {
          sourceId: thread.id, inquiryId, direction: MessageDirection.Inbound, status: MessageStatus.Received,
          fromAddr: p.fromAddr, toAddr: p.toAddr, subject: p.subject, body: p.body,
          externalId: p.externalId, inReplyTo: p.inReplyTo, references: p.references ?? [],
          reviewStatus: review.status, riskScore: review.score, riskTags: review.categories,
        },
        tx,
      });
      await this.sources.updateThreadState({ sourceId: thread.id, lastInboundAt: m.createdAt, tx });
      // A blocked inbound is never announced — the customer must not see it stream in.
      if (!blocked) {
        await this.outbox.emit({ type: EventType.MessageReceived, reportId, epicId, inquiryId, data: { from: p.fromAddr, sourceId: thread.id }, tx });
      }
      return m;
    });
    return { duplicate: false, blocked, reportId, inquiryId, sourceId: thread.id, message: msg };
  }
}

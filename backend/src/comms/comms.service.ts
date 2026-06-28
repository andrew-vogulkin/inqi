import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BossService } from '../queue/boss.service';
import { OutboxService } from '../events/outbox.service';
import { WorkflowEngine } from '../workflow/engine.service';
import { QwenService } from '../ai/qwen.service';
import { getPersona, pickPersona, personaSystem } from '../ai/personas';

/** Agent communication track. Every subject-provider Subtask is one email thread. Agents
 *  draft + send (DEPTH model), inbound replies are saved + threaded, and a reply
 *  loop continues the dialogue until qualified / disqualified / closed.
 *  See DESIGN.md §10. */
@Injectable()
export class CommsService implements OnModuleInit {
  constructor(
    private db: PrismaService, private boss: BossService,
    private outbox: OutboxService, private wf: WorkflowEngine, private qwen: QwenService,
  ) {}

  /** Unique inbound address so a reply maps back to exactly one subtask thread. */
  private replyAddressFor(token: string) {
    return `${token}@${process.env.INBOUND_DOMAIN ?? 'reply.inqi.example'}`;
  }

  /** Build the chat-format chain for the model: oldest->newest, our msgs as
   *  assistant, subject-provider msgs as user. */
  private async chain(subtaskId: string) {
    const msgs = await this.db.inquiryMessage.findMany({ where: { subtaskId }, orderBy: { createdAt: 'asc' } });
    return msgs.map((m) => ({ role: (m.direction === 'outbound' ? 'assistant' : 'user') as const, content: `Subject: ${m.subject ?? ''}\n${m.body}` }));
  }

  /** Compact epic memory: shared phrasing + what worked / failed on sibling subtasks. */
  private async epicContext(epicId: string) {
    const epic = await this.db.epic.findUniqueOrThrow({ where: { id: epicId }, include: { subtasks: true } });
    const qualified = epic.subtasks.filter((s) => s.status === 'qualified').map((s) => `${s.subjectProviderName}: ${JSON.stringify(s.result)}`);
    const failed = epic.subtasks.filter((s) => s.status === 'failed').map((s) => s.subjectProviderName);
    return `Shared context: ${JSON.stringify(epic.sharedContext)}\nSuccessful cases: ${qualified.join(' | ') || 'none yet'}\nFailed subject providers: ${failed.join(', ') || 'none'}`;
  }

  /** Send the first inquiry email for a subtask (DEPTH model drafts it). */
  async sendInquiry(inquiryId: string, subtaskId: string) {
    const st = await this.db.subtask.findUniqueOrThrow({ where: { id: subtaskId } });
    const regionHint = (st.contact as any)?.country ?? (st.contact as any)?.region ?? null; // subject-provider locale
    const persona = st.personaId ? getPersona(st.personaId) : pickPersona(regionHint);
    const token = randomBytes(16).toString('hex');
    const replyAddress = this.replyAddressFor(token);
    const ctx = await this.epicContext(st.epicId);
    const subject = await this.db.subject.findFirst({ where: { inquiry: { epics: { some: { id: st.epicId } } } } });

    // DEPTH draft in this persona's voice. TODO real call:
    //   const system = personaSystem(persona, 'Write the first outreach email.');
    //   const body = await this.qwen.chat([{ role:'system', content: system + '\n' + ctx }, { role:'user', content: subject?.title ?? '' }], 'depth');
    const body = `Hello ${st.subjectProviderName},\n\nWe're researching: ${subject?.title ?? 'an item/service'}.\nCould you share price, availability and lead time?\n\nWarm regards,\n${persona.name}\nInqi Tech Service Provider`;
    const review = await this.scoreCompliance(body); // ethical+legal gate before send
    const externalId = `<${randomUUID()}@inqi>`;

    if (review.status === 'blocked') { await this.db.subtask.update({ where: { id: subtaskId }, data: { status: 'failed', convState: 'closed' } }); return null; }
    await this.db.subtask.update({ where: { id: subtaskId }, data: { replyAddress, status: 'contacted', convState: 'awaiting_reply', personaId: persona.id } });
    const msg = await this.db.inquiryMessage.create({
      data: { subtaskId, direction: 'outbound', status: 'sent', fromAddr: replyAddress, toAddr: (st.contact as any)?.email ?? null,
        subject: `Inquiry: ${subject?.title ?? ''}`, body, externalId, references: [externalId], modelTier: 'depth',
        personaId: persona.id, reviewStatus: review.status, riskScore: review.score },
    });
    await this.outbox.emit('message.sent', { inquiryId, epicId: st.epicId, subtaskId, data: { to: msg.toAddr, replyAddress } });
    // TODO: send via Postmark (chosen) with Reply-To: replyAddress; inbound parse webhook -> POST /api/comms/inbound.

    if ((process.env.SIMULATE_REPLIES ?? 'false') === 'true') {
      await this.boss.boss.send('simulate_inbound', { subtaskId, inReplyTo: externalId }, { startAfter: 2 });
    }
    return msg;
  }

  /** Save an inbound subject-provider email and queue the reply loop. Idempotent on Message-ID. */
  async ingestInbound(p: { toAddr: string; fromAddr?: string; subject?: string; body: string; externalId?: string; inReplyTo?: string; references?: string[] }) {
    const token = p.toAddr.split('@')[0];
    const st = await this.db.subtask.findFirst({ where: { replyAddress: this.replyAddressFor(token) }, include: { epic: true } });
    if (!st) throw new NotFoundException('no subtask thread for that address');
    if (p.externalId) {
      const dup = await this.db.inquiryMessage.findUnique({ where: { externalId: p.externalId } });
      if (dup) return dup; // already ingested
    }
    const msg = await this.db.inquiryMessage.create({
      data: { subtaskId: st.id, direction: 'inbound', status: 'received', fromAddr: p.fromAddr, toAddr: p.toAddr,
        subject: p.subject, body: p.body, externalId: p.externalId, inReplyTo: p.inReplyTo, references: p.references ?? [] },
    });
    await this.db.subtask.update({ where: { id: st.id }, data: { status: 'replied', convState: 'needs_action', lastInboundAt: new Date() } });
    await this.outbox.emit('message.received', { inquiryId: st.epic.inquiryId, epicId: st.epicId, subtaskId: st.id, data: { from: p.fromAddr } });
    await this.boss.boss.send('process_reply', { inquiryId: st.epic.inquiryId, subtaskId: st.id });
    return msg;
  }

  async onModuleInit() {
    // The reply loop: read the chain + epic memory, DEPTH-decide the next action.
    await this.boss.work<{ inquiryId: string; subtaskId: string }>('process_reply', async (job) => {
      const { inquiryId, subtaskId } = job.data;
      const st = await this.db.subtask.findUniqueOrThrow({ where: { id: subtaskId } });
      const persona = getPersona(st.personaId); // same persona carries the thread
      const chain = await this.chain(subtaskId);
      const ctx = await this.epicContext(st.epicId);

      // DEPTH model decides: continue | qualify | disqualify | escalate (+ optional draft/result).
      // TODO real prompt with strict JSON. Stubbed decision keeps the demo flowing.
      const decision: any = await this.fakeDecide(chain).catch(() => ({ intent: 'qualify', result: { price: 1290, currency: 'EUR', availability: 'in stock', leadTime: '1-2w' } }));

      if (decision.intent === 'continue') {
        const externalId = `<${randomUUID()}@inqi>`;
        await this.db.inquiryMessage.create({ data: { subtaskId, direction: 'outbound', status: 'sent', subject: 'Re: inquiry',
          body: (decision.draft ?? 'Thanks — one follow-up: can you confirm the price including delivery?') + `\n\n${persona.name}`, externalId, modelTier: 'depth',
          personaId: persona.id, references: [externalId] } });
        await this.db.subtask.update({ where: { id: subtaskId }, data: { status: 'contacted', convState: 'awaiting_reply' } });
        await this.outbox.emit('message.sent', { inquiryId, epicId: st.epicId, subtaskId, data: { followup: true } });
        if ((process.env.SIMULATE_REPLIES ?? 'false') === 'true') await this.boss.boss.send('simulate_inbound', { subtaskId, inReplyTo: externalId }, { startAfter: 2 });
        return;
      }
      if (decision.intent === 'disqualify' || decision.intent === 'escalate') {
        await this.db.subtask.update({ where: { id: subtaskId }, data: { status: 'failed', convState: 'closed' } });
        await this.outbox.emit('subtask.updated', { inquiryId, epicId: st.epicId, subtaskId, data: { status: 'failed', reason: decision.reason } });
      } else { // qualify
        await this.db.subtask.update({ where: { id: subtaskId }, data: { status: 'qualified', convState: 'closed', result: decision.result } });
        // Dynamic report: append a finding the report assembles on read.
        await this.db.finding.create({ data: { inquiryId, epicId: st.epicId, subtaskId, kind: 'option', data: { subjectProvider: st.subjectProviderName, ...decision.result } } });
        // TODO: also run subject-provider background research (ratings/feedback/eligibility) -> Finding 'subject_provider_background'.
        await this.outbox.emit('subtask.updated', { inquiryId, epicId: st.epicId, subtaskId, data: { status: 'qualified', result: decision.result } });
      }
      await this.maybeFinishEpic(inquiryId, st.epicId);
    });

    // Demo only: fabricate a subject-provider reply so the pipeline completes without real email.
    await this.boss.work<{ subtaskId: string; inReplyTo?: string }>('simulate_inbound', async (job) => {
      const st = await this.db.subtask.findUniqueOrThrow({ where: { id: job.data.subtaskId } });
      await this.ingestInbound({ toAddr: st.replyAddress!, fromAddr: `sales@${st.subjectProviderName.toLowerCase().replace(/\s+/g, '')}.example`,
        subject: 'Re: inquiry', body: `Yes, in stock. Price ${100 + Math.floor(Math.random() * 900)} EUR, lead time 1-2 weeks.`,
        externalId: `<${randomUUID()}@subject-provider>`, inReplyTo: job.data.inReplyTo, references: job.data.inReplyTo ? [job.data.inReplyTo] : [] });
    });
  }

  /** When the epic has enough qualified options (or no open threads), finish outreach. */
  private async maybeFinishEpic(inquiryId: string, epicId: string) {
    const epic = await this.db.epic.findUniqueOrThrow({ where: { id: epicId }, include: { subtasks: true } });
    const qualified = epic.subtasks.filter((s) => s.status === 'qualified').length;
    const open = epic.subtasks.filter((s) => ['pending', 'researching', 'contacted', 'replied'].includes(s.status)).length;
    if (qualified >= epic.targetQualifiedOptions || open === 0) {
      const inq = await this.db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
      if (inq.state === 'OUTREACH') await this.wf.advance(inquiryId, 'OUTREACH_DONE');
    }
  }

  /** Ethical + legal scoring gate. Every outbound email AND questionnaire passes
   *  through this before it leaves inqi, so customers are never shown anything
   *  illegal/unsafe. TODO: real Qwen rubric -> { score 0..1, tags[] }. */
  private async scoreCompliance(text: string): Promise<{ status: 'passed' | 'blocked'; score: number; tags: string[] }> {
    // const r = await this.qwen.json(COMPLIANCE_SYS, text, 'balanced');
    return { status: 'passed', score: 0, tags: [] };
  }

  private async fakeDecide(chain: any[]): Promise<any> {
    // Placeholder for: this.qwen.json(REPLY_SYS, JSON.stringify(chain), 'depth')
    return { intent: 'qualify', result: { price: 100 + Math.floor(Math.random() * 900), currency: 'EUR', availability: 'in stock', leadTime: '1-2w' } };
  }
}

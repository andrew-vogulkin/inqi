import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BossService } from '../queue/boss.service';
import { OutboxService } from '../events/outbox.service';
import { WorkflowEngine } from '../workflow/engine.service';
import { QwenService } from '../ai/qwen.service';
import { QuestionnaireService } from '../questionnaire/questionnaire.service';
import { CommsService } from '../comms/comms.service';

/** Each pipeline stage is a pg-boss job with its own worker. Bodies here are
 *  skeletons that emit realistic events and advance the workflow; swap the TODO
 *  blocks for real Qwen prompts / email / parsing. See DESIGN.md §4 & §8. */
@Injectable()
export class AgentsService implements OnModuleInit {
  constructor(
    private db: PrismaService, private boss: BossService, private outbox: OutboxService,
    private wf: WorkflowEngine, private qwen: QwenService, private questionnaire: QuestionnaireService, private comms: CommsService,
  ) {}

  private async run<T>(inquiryId: string, stage: string, fn: (log: (m: string, d?: any) => Promise<void>) => Promise<void>) {
    const r = await this.db.agentRun.create({ data: { inquiryId, stage } });
    const log = async (message: string, data?: any) => {
      await this.db.agentEvent.create({ data: { runId: r.id, kind: 'progress', message, data } });
      await this.outbox.emit('agent.progress', { inquiryId, data: { stage, message } });
    };
    await this.outbox.emit('agent.started', { inquiryId, data: { stage } });
    try {
      await fn(log);
      await this.db.agentRun.update({ where: { id: r.id }, data: { status: 'done', endedAt: new Date() } });
      await this.outbox.emit('agent.stopped', { inquiryId, data: { stage, status: 'done' } });
    } catch (e: any) {
      await this.db.agentRun.update({ where: { id: r.id }, data: { status: 'failed', error: String(e?.message ?? e), endedAt: new Date() } });
      await this.outbox.emit('agent.failed', { inquiryId, data: { stage, error: String(e?.message ?? e) } });
      throw e;
    }
  }

  async onModuleInit() {
    // 2. Pre-research + ethical/feasibility evaluation
    await this.boss.work<{ inquiryId: string }>('pre_research', async (job) => {
      const { inquiryId } = job.data;
      await this.run(inquiryId, 'pre_research', async (log) => {
        const inq = await this.db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
        await log('Pre-researching subject + ethical/feasibility evaluation');
        // TODO Qwen: const { decision, riskTags, enriched } = await this.qwen.json(ETHICS_SYS, inq.rawRequest);
        const decision = 'allow';
        if (decision !== 'allow') {
          await this.db.inquiry.update({ where: { id: inquiryId }, data: { denyReason: 'policy' } });
          return void (await this.wf.advance(inquiryId, 'PRE_RESEARCH_DENIED'));
        }
        await this.db.subject.create({
          data: { inquiryId, title: inq.rawRequest.slice(0, 80), description: inq.rawRequest, category: 'item' },
        });
        await this.wf.advance(inquiryId, 'PRE_RESEARCH_PASSED'); // action: send:questionnaire
      });
    });

    // 2.1 Build + send the questionnaire (temp link)
    await this.boss.work<{ inquiryId: string }>('send_questionnaire', async (job) => {
      const { inquiryId } = job.data;
      await this.run(inquiryId, 'send_questionnaire', async (log) => {
        // TODO Qwen: generate targeted questions from the enriched subject.
        const questions = [
          { id: 'confirm', prompt: 'Is this what you are looking for?', type: 'confirm' },
          { id: 'budget', prompt: 'Whats your budget range?', type: 'text' },
          { id: 'where', prompt: 'Preferred location / radius?', type: 'text' },
          { id: 'when', prompt: 'By when do you need it?', type: 'text' },
        ];
        const link = await this.questionnaire.createForInquiry(inquiryId, questions);
        await log('Questionnaire link generated', { link }); // TODO: email link to customer
      });
    });

    // 3.1 Enrich subject from questionnaire answers
    await this.boss.work<{ inquiryId: string }>('enrich_subject', async (job) => {
      const { inquiryId } = job.data;
      await this.run(inquiryId, 'enrich_subject', async (log) => {
        await log('Enriching subject from questionnaire answers'); // TODO Qwen
        await this.wf.advance(inquiryId, 'ENRICHMENT_DONE');
      });
    });

    // 3.2 Broad research: geo, time, price, economic sense (+ reuse check)
    await this.boss.work<{ inquiryId: string }>('broad_research', async (job) => {
      const { inquiryId } = job.data;
      await this.run(inquiryId, 'broad_research', async (log) => {
        await log('Broad research (BREADTH model): geo, time, price, economic sense; checking prior reports'); // TODO reuse + Qwen
        await this.wf.advance(inquiryId, 'BROAD_RESEARCH_DONE');
      });
    });

    // 4. Funnel: form subject-provider/source list → create Epic + Subtasks
    await this.boss.work<{ inquiryId: string }>('build_funnel', async (job) => {
      const { inquiryId } = job.data;
      await this.run(inquiryId, 'build_funnel', async (log) => {
        const epic = await this.db.epic.create({
          data: { inquiryId, definition: { geo: true, time: true, price: true }, strategy: 'escalating', targetQualifiedOptions: 3 },
        });
        await this.outbox.emit('epic.created', { inquiryId, epicId: epic.id, data: { strategy: epic.strategy } });
        // TODO research (BREADTH model): discover real subject providers. Demo: seed 13 (1:3:9 waves).
        const demoRegions = ['HK', 'NL', 'UAE', 'South Africa', 'USA', 'Brazil', 'UK', 'Singapore'];
        const subjectProviders = Array.from({ length: 13 }, (_, i) => ({ name: `Subject Provider ${i + 1}`, wave: i === 0 ? 1 : i < 4 ? 2 : 3, country: demoRegions[i % demoRegions.length] }));
        for (const p of subjectProviders) {
          const st = await this.db.subtask.create({ data: { epicId: epic.id, subjectProviderName: p.name, wave: p.wave, contact: { country: p.country } } });
          await this.outbox.emit('subtask.created', { inquiryId, epicId: epic.id, subtaskId: st.id, data: { subjectProviderName: p.name, wave: p.wave } });
        }
        await log(`Funnel built: ${subjectProviders.length} subject providers`);
        await this.wf.advance(inquiryId, 'FUNNEL_BUILT');
      });
    });

    // 4.1 Outreach: release waves per strategy, run a subtask inquiry each
    await this.boss.work<{ inquiryId: string }>('start_outreach', async (job) => {
      const { inquiryId } = job.data;
      const epic = await this.db.epic.findFirstOrThrow({ where: { inquiryId }, orderBy: { createdAt: 'desc' } });
      const waves = epic.strategy === 'parallel' ? [[1, 2, 3]] : epic.strategy === 'one_by_one' ? [[1], [2], [3]] : [[1], [2], [3]];
      for (const wave of waves) {
        const subs = await this.db.subtask.findMany({ where: { epicId: epic.id, wave: { in: wave }, status: 'pending' } });
        // Orchestrator: higher epic.priority (1=highest) -> higher queue priority + rate-limited concurrency.
        await Promise.all(subs.map((s) => this.boss.boss.send('outreach_subtask', { inquiryId, subtaskId: s.id }, { priority: 10 - epic.priority })));
        // TODO: wait for replies/timeout; stop early once targetQualifiedOptions reached. Demo fires all waves.
      }
      // OUTREACH_DONE is fired by CommsService.maybeFinishEpic once enough
      // subtasks qualify or all threads close (the reply loop drives completion).
    });

    await this.boss.work<{ inquiryId: string; subtaskId: string }>('outreach_subtask', async (job) => {
      const { inquiryId, subtaskId } = job.data;
      await this.run(inquiryId, 'outreach_subtask', async (log) => {
        const st = await this.db.subtask.findUniqueOrThrow({ where: { id: subtaskId } });
        await this.db.subtask.update({ where: { id: subtaskId }, data: { status: 'researching' } });
        await this.outbox.emit('subtask.updated', { inquiryId, epicId: st.epicId, subtaskId, data: { status: 'researching' } });
        // DEPTH research + draft, then open the subject-provider email thread. The reply
        // loop (CommsService.process_reply) continues the dialogue and qualifies.
        await this.comms.sendInquiry(inquiryId, subtaskId);
        await log(`Inquiry email sent to ${st.subjectProviderName}; awaiting reply`);
      });
    });

    // 5. Report synthesis
    await this.boss.work<{ inquiryId: string }>('generate_report', async (job) => {
      const { inquiryId } = job.data;
      await this.run(inquiryId, 'generate_report', async (log) => {
        const epics = await this.db.epic.findMany({ where: { inquiryId }, include: { subtasks: true } });
        const options = epics.flatMap((e) => e.subtasks.filter((s) => s.status === 'qualified').map((s) => ({ subjectProvider: s.subjectProviderName, ...(s.result as object) })));
        const { randomBytes } = await import('crypto');
        const report = await this.db.report.create({
          data: {
            inquiryId, token: randomBytes(20).toString('hex'),
            summary: `Found ${options.length} qualified options.`, // TODO Qwen synthesis
            options, timeline: { generatedAt: new Date().toISOString() },
          },
        });
        await this.outbox.emit('report.ready', { inquiryId, data: { reportToken: report.token, options: options.length } });
        await log('Report generated');
        await this.wf.advance(inquiryId, 'REPORT_READY'); // -> REPORT_DELIVERED
      });
    });
  }
}

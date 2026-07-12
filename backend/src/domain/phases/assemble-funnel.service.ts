import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BreadthPurpose, EventType, FindingKind, OutreachStrategy, QueueJob, WorkflowEvent } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { ConfigService } from '../../infra/config/config.service';
import { ConflictError } from '../../common/errors';
import { SourcesService } from '../source/sources.service';
import { OrchestratorRepository } from '../orchestrator/orchestrator.repository';
import { OutreachControlService } from '../orchestrator/outreach-control.service';
import { WorkflowEngine } from '../orchestrator/workflow-engine.service';
import { ReportTunablesService } from '../orchestrator/report-tunables.service';
import { assignWaves, escalatingWaves } from '../orchestrator/planning';
import { DiscoveredProvider } from '../subject-providers/discovery.tokens';
import { PhaseRunRepository } from './phase-run.repository';
import { BreadthRunData } from './breadth-search.steps';

/**
 * Turns a finished breadth_search run into funnel inquiries. Funnel purpose:
 * assign waves, create inquiries + evidence Sources + depth runs, fire
 * FUNNEL_BUILT. Widen purpose: append the fresh candidates as a new wave and
 * release it — or finish outreach when discovery came back empty. Failure maps
 * by purpose: funnel → FUNNEL_FAILED; widen degrades to finishing outreach.
 */
@Injectable()
export class AssembleFunnelService implements OnModuleInit {
  private readonly logger = new Logger(AssembleFunnelService.name);

  constructor(
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly repo: OrchestratorRepository,
    private readonly phaseRuns: PhaseRunRepository,
    private readonly sources: SourcesService,
    private readonly outreach: OutreachControlService,
    private readonly wf: WorkflowEngine,
    private readonly tunables: ReportTunablesService,
  ) {}

  async onModuleInit() {
    await this.boss.work<{ runId: string }>({ job: QueueJob.AssembleFunnel, handler: (j) => this.assemble(j.data) });
  }

  async assemble({ runId }: { runId: string }): Promise<void> {
    const run = await this.phaseRuns.findById({ id: runId });
    if (!run) return;
    const d = run.data as unknown as BreadthRunData;
    const reportId = run.reportId;
    try {
      if (d.purpose === BreadthPurpose.Widen) await this.assembleWiden({ reportId, d });
      else await this.assembleFunnel({ reportId, d });
    } catch (e) {
      const error = (e as Error).message;
      this.logger.error(`funnel assembly failed for run ${runId} (${d.purpose}): ${error}`);
      if (d.purpose === BreadthPurpose.Funnel) {
        await this.tolerantAdvance({ reportId, event: WorkflowEvent.FUNNEL_FAILED });
      } else {
        await this.outreach.finishOutreach({ reportId }); // widen failure degrades: ship what exists
      }
    }
  }

  /** Funnel purpose: waves for every candidate, depth run per inquiry, FUNNEL_BUILT. */
  private async assembleFunnel({ reportId, d }: { reportId: string; d: BreadthRunData }): Promise<void> {
    // Discovery found NOTHING: fail the funnel honestly (credit refund + denial-style
    // notification via the report failure path). An empty funnel must never be padded
    // with fabricated candidates, and building it would strand the report in OUTREACH
    // with no inquiries to ever settle.
    if (!d.candidates.length) {
      this.logger.warn(`breadth run found no candidates for report ${reportId} — failing the funnel (no fabricated providers)`);
      await this.tolerantAdvance({ reportId, event: WorkflowEvent.FUNNEL_FAILED });
      return;
    }
    // Report genes (carrier B): cap + wave plan from the report's pinned version.
    const genes = await this.tunables.forReport({ reportId });
    const breadthCap = genes.breadthCap ?? this.config.research.maxBreadthInquiries;
    const strategy = OutreachStrategy.ESCALATING;
    for (const c of assignWaves({ candidates: d.candidates.slice(0, breadthCap), strategy, waves: escalatingWaves(genes) })) {
      await this.createInquiry({ reportId, epicId: d.epicId, candidate: c, wave: c.wave });
    }
    this.logger.log(`funnel assembled from breadth run: ${Math.min(d.candidates.length, breadthCap)} candidates (cap ${breadthCap})`);
    await this.tolerantAdvance({ reportId, event: WorkflowEvent.FUNNEL_BUILT });
  }

  /** Widen purpose: fresh candidates become the next wave (released immediately); empty → finish. */
  private async assembleWiden({ reportId, d }: { reportId: string; d: BreadthRunData }): Promise<void> {
    const genes = await this.tunables.forReport({ reportId });
    const breadthCap = genes.breadthCap ?? this.config.research.maxBreadthInquiries;
    const epic = await this.repo.findEpicWithInquiries({ epicId: d.epicId });
    const existingNames = new Set(epic.inquiries.map((s) => s.name));
    const fresh = d.candidates
      .filter((c) => !existingNames.has(c.name))
      .slice(0, Math.max(0, breadthCap - epic.inquiries.length));
    if (!fresh.length) {
      this.logger.log(`widen run produced nothing fresh for report ${reportId} — finishing outreach`);
      await this.outreach.finishOutreach({ reportId });
      return;
    }
    const nextWave = Math.max(...epic.inquiries.map((s) => s.wave), 0) + 1;
    for (const c of fresh) {
      await this.createInquiry({ reportId, epicId: d.epicId, candidate: c, wave: nextWave });
    }
    await this.outbox.emit({ type: EventType.FunnelWidened, reportId, epicId: d.epicId, data: { added: fresh.length, wave: nextWave } });
    await this.repo.createFinding({ data: { reportId, epicId: d.epicId, kind: FindingKind.Note, data: { note: `Widened discovery: ${fresh.length} new candidates (wave ${nextWave})` } as Prisma.InputJsonValue } });
    await this.outreach.releaseWave({ reportId, epicId: d.epicId, wave: nextWave, priority: epic.priority });
  }

  /** One inquiry + its discovery-evidence Sources + the created event + its depth run job. */
  private async createInquiry({ reportId, epicId, candidate: c, wave }: { reportId: string; epicId: string; candidate: DiscoveredProvider; wave: number }): Promise<void> {
    const st = await this.repo.createInquiry({
      data: {
        reportId, epicId, name: c.name, wave, leadSource: c.source,
        contact: {
          country: c.country,
          ...(c.matchNote ? { matchNote: c.matchNote } : {}),
          ...(c.website ? { website: c.website } : {}),
          ...(c.socials?.length ? { socials: c.socials } : {}),
          ...(c.facts?.length ? { facts: c.facts } : {}),
        },
      },
    });
    if (c.evidence?.length) await this.sources.addWebsearch({ reportId, inquiryId: st.id, results: c.evidence });
    await this.outbox.emit({ type: EventType.InquiryCreated, reportId, epicId, inquiryId: st.id, data: { name: c.name, wave, leadSource: c.source } });
    // Depth task per candidate — queued immediately (not gated behind outreach waves).
    await this.boss.enqueue({ job: QueueJob.ResearchBackground, data: { reportId, inquiryId: st.id } });
  }

  private async tolerantAdvance({ reportId, event }: { reportId: string; event: WorkflowEvent }): Promise<void> {
    try {
      await this.wf.advance({ reportId, event });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      this.logger.debug(`report ${reportId} already moved past ${event} — tolerated`);
    }
  }
}

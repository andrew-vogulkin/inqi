import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueJob } from '@inqi/shared';
import { AI_PROVIDER, AiProvider } from '../../../infra/ai/ai.tokens';
import { PrismaService } from '../../../infra/persistence/prisma.service';
import { BossService } from '../../../infra/queue/boss.service';
import { composeCandidate } from './subject-build.compose';
import { compareSubjectGraphs } from './subject-rehearsal';
import { SUBJECT_CASES } from './subject-cases';
import { runProposal } from './subject-build.proposer';
import { loadActiveSubjectBuildGraph, saveDraftSubjectBuildVersion } from './graph-store';

/**
 * The subject_build self-improvement worker. Fired ~5% of deliveries (see the
 * trigger, rolled in the workflow engine): compose a candidate composition, gate it
 * (static validator), rehearse it vs the active baseline over the golden cases, and
 * DRAFT the winner for operator review in /admin/workflows — never auto-published.
 * Runs off the queue so it never blocks a report.
 */
@Injectable()
export class SubjectBuildProposerService implements OnModuleInit {
  private readonly logger = new Logger(SubjectBuildProposerService.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly db: PrismaService,
    private readonly boss: BossService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.boss.work({ job: QueueJob.ProposeSubjectBuild, handler: () => this.propose() });
  }

  private async propose(): Promise<void> {
    if (!this.ai.isConfigured()) return;
    const baseline = await loadActiveSubjectBuildGraph(this.db);
    try {
      const result = await runProposal({
        baseline,
        cases: SUBJECT_CASES,
        deps: {
          compose: (b) => composeCandidate({ ai: this.ai, baseline: b }),
          rehearse: (args) => compareSubjectGraphs({ ...args, deps: { ai: this.ai, findReuse: async () => null } }),
          saveDraft: async ({ candidate, comparison }) => {
            const { version } = await saveDraftSubjectBuildVersion(this.db, candidate);
            this.logger.log(`subject_build candidate DRAFTED as v${version} (baseline ${comparison.baseline.passed}/${comparison.baseline.total} → candidate ${comparison.candidate.passed}/${comparison.candidate.total}; gains ${comparison.gains.join(', ') || '—'}) — awaiting operator publish`);
          },
        },
      });
      if (result.outcome === 'invalid') this.logger.log(`subject_build proposal invalid: ${result.errors.slice(0, 3).join('; ')}`);
      else if (result.outcome === 'rejected') this.logger.log(`subject_build proposal rejected — did not beat baseline (regressions ${result.comparison.regressions.join(', ') || 'none'})`);
    } catch (e) {
      this.logger.warn(`subject_build proposal errored: ${(e as Error).message}`);
    }
  }
}

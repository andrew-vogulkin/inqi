import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventType, FindingKind, QueueJob, UsageKind } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { UsageService } from '../../infra/usage/usage.service';
import { UsageContextService } from '../../infra/usage/usage-context.service';
import { SubjectProvidersRepository } from './subject-providers.repository';
import { BACKGROUND_RESEARCH_SOURCE, BackgroundResearchSource, SubjectProviderBackground } from './background.tokens';
import { DISCOVERY_SOURCE, DiscoverArgs, DiscoveredProvider, DiscoverySource } from './discovery.tokens';

/**
 * Subject-provider discovery + background/quality research. Discovery seeds the
 * funnel (real candidates via the {@link DISCOVERY_SOURCE} seam); background
 * research scores each provider's eligibility/quality so the report ranks on
 * quality, not just price.
 */
@Injectable()
export class SubjectProvidersService implements OnModuleInit {
  constructor(
    private readonly repo: SubjectProvidersRepository,
    private readonly boss: BossService,
    private readonly outbox: OutboxService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(BACKGROUND_RESEARCH_SOURCE) private readonly source: BackgroundResearchSource,
    @Inject(DISCOVERY_SOURCE) private readonly discovery: DiscoverySource,
    private readonly usage: UsageService,
    private readonly usageCtx: UsageContextService,
  ) {}

  async onModuleInit() {
    await this.boss.work<{ inquiryId: string; subtaskId: string }>({
      job: QueueJob.ResearchBackground,
      handler: (job) => this.researchBackground(job.data).then(() => undefined),
    });
  }

  /** Discover candidate subject providers for the funnel (delegates to the seam; counted for cost). */
  discover(args: DiscoverArgs): Promise<DiscoveredProvider[]> {
    void this.usage.recordAction({ inquiryId: this.usageCtx.inquiryId(), kind: UsageKind.DiscoveryCall });
    return this.discovery.discover(args);
  }

  /**
   * Research a subject provider's eligibility/quality, persist it to the subtask
   * + a Finding (which the dynamic report reads), and emit subtask.updated with
   * the qualityScore so the admin board reflects it live.
   */
  async researchBackground({ inquiryId, subtaskId }: { inquiryId: string; subtaskId: string }): Promise<SubjectProviderBackground> {
    void this.usage.recordAction({ inquiryId, kind: UsageKind.BackgroundResearch });
    const st = await this.repo.findSubtask({ id: subtaskId });
    const contact = (st.contact ?? {}) as { country?: string; region?: string };
    const regionHint = contact.country ?? contact.region ?? null;

    // BREADTH (qwen-turbo): gather candidate signals widely; pull external ratings if a source is wired.
    const external = await this.source.lookup({ subjectProviderName: st.subjectProviderName, regionHint });
    // TODO BREADTH: const gathered = await this.ai.json({ system: GATHER_SYS, user: st.subjectProviderName, tier: ModelTier.Breadth });
    // DEPTH (qwen-max): final eligibility judgement + qualityScore.
    // TODO DEPTH: const judged = await this.ai.json({ system: JUDGE_SYS, user: JSON.stringify({ gathered, external }), tier: ModelTier.Depth });
    const background = this.deriveBackground({ name: st.subjectProviderName, external: external.sources });

    await this.repo.updateBackground({ id: subtaskId, background: background as unknown as Prisma.InputJsonValue, qualityScore: background.qualityScore });
    await this.repo.createFinding({
      data: {
        inquiryId, epicId: st.epicId, subtaskId, kind: FindingKind.SubjectProviderBackground,
        qualityScore: background.qualityScore,
        data: { subjectProvider: st.subjectProviderName, ...background } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.outbox.emit({ type: EventType.SubtaskUpdated, inquiryId, epicId: st.epicId, subtaskId, data: { qualityScore: background.qualityScore } });
    return background;
  }

  /**
   * Deterministic stub for model-derived signals (no live AI/ratings tooling
   * yet). Varies per provider so ranking is meaningful in the demo. Replaced by
   * the BREADTH gather + DEPTH judgement at the TODO seams above.
   */
  private deriveBackground({ name, external }: { name: string; external: string[] }): SubjectProviderBackground {
    const h = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const qualityScore = Math.round((0.45 + (h % 50) / 100) * 100) / 100; // 0.45..0.94
    const rating = Math.round((3 + (h % 20) / 10) * 10) / 10; // 3.0..4.9
    const reviewsCount = 20 + (h % 480);
    const redFlags = qualityScore < 0.55 ? ['limited track record'] : [];
    const sources = external.length ? external : ['model-derived (no live ratings source configured)'];
    return {
      rating,
      reviewsCount,
      sources,
      eligibility: qualityScore >= 0.6 ? 'eligible' : 'eligible with caution',
      redFlags,
      qualityScore,
    };
  }
}

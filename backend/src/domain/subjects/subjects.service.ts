import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModelTier, SubjectCategory } from '@inqi/shared';
import { AI_PROVIDER, AiProvider, EMBEDDINGS_PROVIDER, EmbeddingsProvider } from '../../infra/ai/ai.tokens';
import { ConfigService } from '../../infra/config/config.service';
import { SubjectsRepository, ReusableReport } from './subjects.repository';
import { decideReuse } from './reuse';
import {
  BROAD_RESEARCH_SYSTEM, ENRICHMENT_SYSTEM, broadResearchSchema, buildBroadResearchUser, buildEnrichmentUser, enrichmentSchema,
} from './subjects.prompts';

/** How many nearest semantic neighbours to fetch before applying the reuse decision. */
const REUSE_CANDIDATE_LIMIT = 10;

/** Enriched subject fields produced by pre-research feasibility (best-effort). */
export interface EnrichedSubject {
  title?: string;
  category?: string;
  summary?: string;
}

/**
 * Subject enrichment + prior-report reuse (pgvector / PostGIS). Pre-research
 * seeds the Subject; enrichment (from questionnaire answers) and broad research
 * refine it via the model-tier router, with deterministic fallbacks when no AI
 * backend is configured so the demo runs end-to-end.
 */
@Injectable()
export class SubjectsService {
  private readonly logger = new Logger(SubjectsService.name);

  constructor(
    private readonly subjects: SubjectsRepository,
    private readonly config: ConfigService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(EMBEDDINGS_PROVIDER) private readonly embeddings: EmbeddingsProvider,
  ) {}

  /**
   * Prior-report reuse: embed the subject, store its vector + geo, then take the
   * nearest semantic neighbours and apply the pure {@link decideReuse} rule
   * (cosine similarity + geo radius + freshness, all config-driven). Returns the
   * first qualifying prior report, or null (gracefully) when reuse is disabled,
   * nothing qualifies, or pgvector/PostGIS aren't available.
   */
  async reuseLookup({ inquiryId }: { inquiryId: string }): Promise<ReusableReport | null> {
    if (!this.config.reuse.enabled) return null;
    const subject = await this.subjects.findByInquiry({ inquiryId });
    if (!subject) return null;
    try {
      const geo = await this.subjects.findInquiryGeo({ inquiryId });
      const embedding = await this.embeddings.embed({ text: `${subject.title}\n${subject.description}` });
      await this.subjects.storeVector({ inquiryId, embedding, lat: geo?.geoLat ?? null, lng: geo?.geoLng ?? null });
      const candidates = await this.subjects.findReusableCandidates({
        inquiryId, embedding, lat: geo?.geoLat ?? null, lng: geo?.geoLng ?? null, limit: REUSE_CANDIDATE_LIMIT,
      });
      const { similarityThreshold, radiusMeters, freshnessDays } = this.config.reuse;
      const hit = candidates.find((c) => decideReuse(c, { similarityThreshold, radiusMeters, freshnessDays }));
      if (!hit) return null;
      this.logger.log(`reusable prior report ${hit.reportId} (cosine ${hit.distance.toFixed(3)}, ${hit.distanceMeters ?? 'n/a'}m, ${hit.ageDays.toFixed(1)}d)`);
      return { reportId: hit.reportId, token: hit.token, distance: hit.distance };
    } catch (e) {
      this.logger.warn(`reuse lookup skipped (pgvector/PostGIS unavailable?): ${(e as Error).message}`);
      return null;
    }
  }

  /** Pre-research: seed the Subject aggregate, using AI-enriched fields when available. */
  createFromInquiry({ inquiryId, rawRequest, enriched }: { inquiryId: string; rawRequest: string; enriched?: EnrichedSubject }) {
    // TODO: check prior reports via this.embeddings.embed + PostGIS distance for reuse.
    return this.subjects.create({
      data: {
        inquiryId,
        title: enriched?.title ?? rawRequest.slice(0, 80),
        description: enriched?.summary || rawRequest,
        category: enriched?.category ?? SubjectCategory.Item,
      },
    });
  }

  /** Enrich the subject from confirmed questionnaire answers (DEPTH-adjacent: BALANCED tier). */
  async enrich({ inquiryId }: { inquiryId: string }): Promise<void> {
    if (!this.ai.isConfigured()) return; // fallback: leave the seeded subject as-is
    try {
      const subject = await this.subjects.findByInquiry({ inquiryId });
      if (!subject) return;
      const answers = await this.subjects.findQuestionnaireAnswers({ inquiryId });
      const result = await this.ai.structured({
        system: ENRICHMENT_SYSTEM,
        user: buildEnrichmentUser({ rawRequest: subject.description, answers }),
        tier: ModelTier.Balanced,
        validate: (raw) => enrichmentSchema.parse(raw),
      });
      const attributes = { ...((subject.attributes as Record<string, unknown>) ?? {}), ...result.attributes, constraints: result.constraints };
      await this.subjects.update({
        inquiryId,
        data: {
          description: result.refinedDescription || subject.description,
          attributes: attributes as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.logger.warn(`enrichment failed; keeping seeded subject: ${(e as Error).message}`);
    }
  }

  /** Broad research over the enriched subject (BREADTH tier); persisted onto attributes. */
  async broadResearch({ inquiryId }: { inquiryId: string }): Promise<void> {
    if (!this.ai.isConfigured()) return; // fallback: no-op, the demo proceeds on stub leads
    try {
      const subject = await this.subjects.findByInquiry({ inquiryId });
      if (!subject) return;
      const result = await this.ai.structured({
        system: BROAD_RESEARCH_SYSTEM,
        user: buildBroadResearchUser({ subject: { title: subject.title, description: subject.description, attributes: subject.attributes } }),
        tier: ModelTier.Breadth,
        validate: (raw) => broadResearchSchema.parse(raw),
      });
      const attributes = { ...((subject.attributes as Record<string, unknown>) ?? {}), broadResearch: result };
      await this.subjects.update({ inquiryId, data: { attributes: attributes as Prisma.InputJsonValue } });
    } catch (e) {
      this.logger.warn(`broad research failed; proceeding without it: ${(e as Error).message}`);
    }
  }
}

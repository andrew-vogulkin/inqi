import { Inject, Injectable, Logger } from '@nestjs/common';
import { ComplianceCategory, ComplianceFailMode, ComplianceKind, ModelTier, ReviewStatus } from '@inqi/shared';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { ConfigService } from '../../infra/config/config.service';
import { ComplianceResult, ComplianceScorer } from './compliance.tokens';
import { COMPLIANCE_SYSTEM, ComplianceVerdict, buildComplianceUser, complianceSchema } from './compliance.prompt';

/**
 * Ethical + legal scorer. Runs the compliance rubric via the model-tier router:
 * starts BALANCED and re-scores at DEPTH when the verdict is borderline. The
 * structured output is zod-validated, and the gate degrades gracefully — when the
 * AI backend is unconfigured or the call/validation fails, the outcome follows
 * COMPLIANCE_FAIL_MODE (open → unscored/allow, closed → block). Bound to the
 * `COMPLIANCE_SCORER` token.
 */
@Injectable()
export class ComplianceService implements ComplianceScorer {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly config: ConfigService,
  ) {}

  async score({ kind, text, tier = ModelTier.Balanced }: { kind: ComplianceKind; text: string; tier?: ModelTier }): Promise<ComplianceResult> {
    if (!this.ai.isConfigured()) return this.fallback();
    try {
      let verdict = await this.run({ kind, text, tier });
      // Borderline at BALANCED → spend a DEPTH pass for a more confident verdict.
      const { low, high } = this.config.complianceBorderline;
      if (tier === ModelTier.Balanced && verdict.riskScore >= low && verdict.riskScore <= high) {
        this.logger.log(`compliance borderline (${verdict.riskScore}) → escalating ${kind} to DEPTH`);
        verdict = await this.run({ kind, text, tier: ModelTier.Depth });
      }
      return {
        status: verdict.allowed ? ReviewStatus.Passed : ReviewStatus.Blocked,
        score: verdict.riskScore,
        categories: verdict.categories as ComplianceCategory[],
        reason: verdict.reason,
      };
    } catch (e) {
      this.logger.warn(`compliance scoring failed (fail-${this.config.complianceFailMode}): ${(e as Error).message}`);
      return this.fallback();
    }
  }

  /** One scoring pass at a given tier. */
  private run({ kind, text, tier }: { kind: ComplianceKind; text: string; tier: ModelTier }): Promise<ComplianceVerdict> {
    return this.ai.structured({
      system: COMPLIANCE_SYSTEM,
      user: buildComplianceUser({ kind, text }),
      tier,
      validate: (raw) => complianceSchema.parse(raw),
    });
  }

  /** Outcome when the scorer can't run, per COMPLIANCE_FAIL_MODE. */
  private fallback(): ComplianceResult {
    if (this.config.complianceFailMode === ComplianceFailMode.Closed) {
      this.logger.warn('compliance scorer unavailable → blocking (fail-closed)');
      return { status: ReviewStatus.Blocked, score: 1, categories: [ComplianceCategory.Other], reason: 'compliance scorer unavailable (fail-closed)' };
    }
    // Fail-open: do not pretend it passed — record `unscored` for audit and let it through.
    this.logger.warn('compliance scorer unavailable → recording unscored (fail-open)');
    return { status: ReviewStatus.Unscored, score: 0, categories: [], reason: 'compliance scorer unavailable (fail-open)' };
  }
}

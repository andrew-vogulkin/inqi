import { Injectable, Logger } from '@nestjs/common';
import { UsageKind } from '@inqi/shared';
import { PrismaService } from '../persistence/prisma.service';

/**
 * Append-only usage ledger (HP-15). Records AI token usage + counted outreach/
 * agent actions. Never throws (cost accounting must not break the pipeline) and
 * skips silently when no report can be attributed.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly db: PrismaService) {}

  /** Record an AI call's token usage (kind ai_call), or an embedding call (kind embedding). */
  async recordAi(args: { reportId?: string; kind?: UsageKind; model?: string | null; modelVersion?: string | null; tier?: string | null; promptTokens?: number; completionTokens?: number; totalTokens?: number; estimated?: boolean }): Promise<void> {
    if (!args.reportId) return;
    try {
      await this.db.usageRecord.create({
        data: {
          reportId: args.reportId, kind: args.kind ?? UsageKind.AiCall, model: args.model ?? null, modelVersion: args.modelVersion ?? null, tier: args.tier ?? null,
          promptTokens: args.promptTokens ?? 0, completionTokens: args.completionTokens ?? 0, totalTokens: args.totalTokens ?? 0,
          estimated: args.estimated ?? false,
        },
      });
    } catch (e) {
      this.logger.warn(`usage record (ai) failed: ${(e as Error).message}`);
    }
  }

  /** Record a counted outreach/agent action (email_sent, reply_processed, discovery_call, background_research). */
  async recordAction({ reportId, kind, quantity = 1 }: { reportId?: string; kind: UsageKind; quantity?: number }): Promise<void> {
    if (!reportId) return;
    try {
      await this.db.usageRecord.create({ data: { reportId, kind, quantity } });
    } catch (e) {
      this.logger.warn(`usage record (${kind}) failed: ${(e as Error).message}`);
    }
  }

  list({ reportId }: { reportId: string }) {
    return this.db.usageRecord.findMany({ where: { reportId }, orderBy: { createdAt: 'asc' } });
  }
}

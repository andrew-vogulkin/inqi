import { Global, Module } from '@nestjs/common';
import { AiDriver, EventType, UsageKind } from '@inqi/shared';
import { ConfigService } from '../config/config.service';
import { UsageService } from '../usage/usage.service';
import { UsageContextService } from '../usage/usage-context.service';
import { OutboxService } from '../events/outbox.service';
import { AI_PROVIDER, EMBEDDINGS_PROVIDER } from './ai.tokens';
import { OnUsage } from './qwen-provider.base';
import { QwenLocalProvider } from './qwen-local.provider';
import { QwenCloudProvider } from './qwen-cloud.provider';
import { EmbeddingsService } from './embeddings.service';

/**
 * Infra (@Global): the LLM + embeddings providers, bound behind interface tokens
 * so integrations swap without touching call sites. AI_PROVIDER resolves to
 * `qwen_local` (spark) or `qwen_cloud` (DashScope) per config.aiDriver.
 */
@Global()
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      useFactory: (config: ConfigService, usage: UsageService, ctx: UsageContextService, outbox: OutboxService) => {
        // Provenance for admins: the first time a distinct model+version touches a
        // report, land a `model.used` event in its history (deduped in-memory; the
        // set is tiny — reports × models — and clears on restart, worst case one
        // duplicate event).
        const announced = new Set<string>();
        // Cost accounting (HP-15): every model call's tokens → the ledger, attributed via the async-local report.
        const onUsage: OnUsage = (u) => {
          const reportId = ctx.reportId();
          void usage.recordAi({
            reportId, kind: UsageKind.AiCall, model: u.model, modelVersion: u.modelVersion, tier: u.tier,
            promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens, estimated: u.estimated,
          });
          if (reportId) {
            const key = `${reportId}:${u.model}:${u.modelVersion}`;
            if (!announced.has(key)) {
              announced.add(key);
              if (announced.size > 10_000) announced.clear(); // bound the memory of a long-lived process
              void outbox.emit({ type: EventType.ModelUsed, reportId, data: { model: u.model, modelVersion: u.modelVersion, tier: u.tier } })
                .catch(() => undefined); // provenance is best-effort — never fail a model call over it
            }
          }
        };
        return config.aiDriver === AiDriver.QwenLocal ? new QwenLocalProvider(config, onUsage) : new QwenCloudProvider(config, onUsage);
      },
      inject: [ConfigService, UsageService, UsageContextService, OutboxService],
    },
    { provide: EMBEDDINGS_PROVIDER, useClass: EmbeddingsService },
  ],
  exports: [AI_PROVIDER, EMBEDDINGS_PROVIDER],
})
export class AiModule {}

import { Global, Module } from '@nestjs/common';
import { AiDriver, UsageKind } from '@inqi/shared';
import { ConfigService } from '../config/config.service';
import { UsageService } from '../usage/usage.service';
import { UsageContextService } from '../usage/usage-context.service';
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
      useFactory: (config: ConfigService, usage: UsageService, ctx: UsageContextService) => {
        // Cost accounting (HP-15): every model call's tokens → the ledger, attributed via the async-local inquiry.
        const onUsage: OnUsage = (u) => void usage.recordAi({
          inquiryId: ctx.inquiryId(), kind: UsageKind.AiCall, model: u.model, tier: u.tier,
          promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens, estimated: u.estimated,
        });
        return config.aiDriver === AiDriver.QwenLocal ? new QwenLocalProvider(config, onUsage) : new QwenCloudProvider(config, onUsage);
      },
      inject: [ConfigService, UsageService, UsageContextService],
    },
    { provide: EMBEDDINGS_PROVIDER, useClass: EmbeddingsService },
  ],
  exports: [AI_PROVIDER, EMBEDDINGS_PROVIDER],
})
export class AiModule {}

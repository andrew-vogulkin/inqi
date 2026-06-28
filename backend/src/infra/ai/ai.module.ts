import { Global, Module } from '@nestjs/common';
import { AiDriver } from '@inqi/shared';
import { ConfigService } from '../config/config.service';
import { AI_PROVIDER, EMBEDDINGS_PROVIDER } from './ai.tokens';
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
      useFactory: (config: ConfigService) =>
        config.aiDriver === AiDriver.QwenLocal ? new QwenLocalProvider(config) : new QwenCloudProvider(config),
      inject: [ConfigService],
    },
    { provide: EMBEDDINGS_PROVIDER, useClass: EmbeddingsService },
  ],
  exports: [AI_PROVIDER, EMBEDDINGS_PROVIDER],
})
export class AiModule {}

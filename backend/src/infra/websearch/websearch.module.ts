import { Global, Module } from '@nestjs/common';
import { WebSearchDriver } from '@inqi/shared';
import { ConfigService } from '../config/config.service';
import { UsageService } from '../usage/usage.service';
import { UsageContextService } from '../usage/usage-context.service';
import { WEB_SEARCH, WebSearchProvider } from './websearch.tokens';
import { SearxngWebSearchProvider } from './searxng.provider';
import { SerperWebSearchProvider } from './serper.provider';

/**
 * Infra (@Global): the web/maps search tools the AI can call, bound behind
 * {@link WEB_SEARCH} so the backend swaps without touching call sites.
 *
 * Exactly ONE driver serves a deployment — they are alternatives, not a chain:
 * - `searxng` — self-hosted, free, but a shared scraped index: throttled to 1 req/s.
 * - `serper`  — hosted Google SERP API: billed per query, no throttle, ~1s p50.
 *
 * Because the provider is fixed per deployment, web-search cost is a flat rate in the
 * price table (`perWebSearch`): set it to 0 where SearXNG runs and to the Serper rate
 * where Serper runs.
 */
@Global()
@Module({
  providers: [
    {
      provide: WEB_SEARCH,
      useFactory: (config: ConfigService, usage: UsageService, usageCtx: UsageContextService): WebSearchProvider => {
        switch (config.webSearchDriver) {
          case WebSearchDriver.Searxng:
            return new SearxngWebSearchProvider(config, usage, usageCtx);
          case WebSearchDriver.Serper:
            // Fail at BOOT, not on the first search: a keyless serper deployment would
            // otherwise look healthy while every single search failed.
            if (!config.serper.apiKey) {
              throw new Error('WEBSEARCH_DRIVER=serper requires SERPER_API_KEY');
            }
            return new SerperWebSearchProvider(config, usage, usageCtx);
          default:
            throw new Error(`unsupported WEBSEARCH_DRIVER: ${config.webSearchDriver}`);
        }
      },
      inject: [ConfigService, UsageService, UsageContextService],
    },
  ],
  exports: [WEB_SEARCH],
})
export class WebSearchModule {}

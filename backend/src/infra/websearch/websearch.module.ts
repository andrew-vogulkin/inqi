import { Global, Module } from '@nestjs/common';
import { WebSearchDriver } from '@inqi/shared';
import { ConfigService } from '../config/config.service';
import { WEB_SEARCH, WebSearchProvider } from './websearch.tokens';
import { SearxngWebSearchProvider } from './searxng.provider';

/**
 * Infra (@Global): web / maps / social / translate / currency tools the AI can
 * call, bound behind {@link WEB_SEARCH} so the backend swaps without touching call
 * sites. Resolves to the self-hosted SearXNG provider today; a hosted/cloud search
 * API slots in as a new `WebSearchDriver` branch below.
 */
@Global()
@Module({
  providers: [
    {
      provide: WEB_SEARCH,
      useFactory: (config: ConfigService): WebSearchProvider => {
        switch (config.webSearchDriver) {
          case WebSearchDriver.Searxng:
            return new SearxngWebSearchProvider(config);
          // case WebSearchDriver.Cloud: return new CloudWebSearchProvider(config); // future hosted search API
          default:
            throw new Error(`unsupported WEBSEARCH_DRIVER: ${config.webSearchDriver}`);
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [WEB_SEARCH],
})
export class WebSearchModule {}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { DiscoverySourceKind, ModelTier } from '@inqi/shared';
import { AI_PROVIDER, AiProvider } from '../../infra/ai/ai.tokens';
import { DiscoverArgs, DiscoveredProvider, DiscoverySource } from './discovery.tokens';
import { discoverySystem, buildDiscoveryUser, discoverySchema } from './discovery.prompt';

const DEMO_REGIONS = ['HK', 'NL', 'UAE', 'South Africa', 'USA', 'Brazil', 'UK', 'Singapore'];

/**
 * AI-proposed candidate discovery (BREADTH tier), with a deterministic fallback
 * so the funnel builds offline. A real web-search / directory API is a future
 * impl behind the same `DISCOVERY_SOURCE` token (no call-site change). Do not scrape.
 */
@Injectable()
export class AiDiscoverySource implements DiscoverySource {
  private readonly logger = new Logger(AiDiscoverySource.name);

  constructor(@Inject(AI_PROVIDER) private readonly ai: AiProvider) {}

  async discover({ subject, count, exclude }: DiscoverArgs): Promise<DiscoveredProvider[]> {
    if (this.ai.isConfigured()) {
      try {
        const result = await this.ai.structured({
          system: discoverySystem(),
          user: buildDiscoveryUser({ subject, count, exclude }),
          tier: ModelTier.Breadth,
          validate: (raw) => discoverySchema.parse(raw),
        });
        const fresh = result.candidates
          .filter((c) => !exclude.includes(c.name))
          .slice(0, count)
          .map((c) => ({ name: c.name, country: c.country || 'unknown', source: DiscoverySourceKind.Ai }));
        if (fresh.length) return fresh;
      } catch (e) {
        this.logger.warn(`AI discovery failed, using fallback: ${(e as Error).message}`);
      }
    }
    return this.fallback({ count, exclude });
  }

  /** Deterministic candidates, skipping any already-excluded names (for widening). */
  private fallback({ count, exclude }: { count: number; exclude: string[] }): DiscoveredProvider[] {
    const out: DiscoveredProvider[] = [];
    for (let i = 1; out.length < count && i < count + exclude.length + 1; i++) {
      const name = `Subject Provider ${i}`;
      if (exclude.includes(name)) continue;
      out.push({ name, country: DEMO_REGIONS[(i - 1) % DEMO_REGIONS.length], source: DiscoverySourceKind.Fallback });
    }
    return out;
  }
}

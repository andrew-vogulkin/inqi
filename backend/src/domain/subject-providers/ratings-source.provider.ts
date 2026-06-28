import { Injectable } from '@nestjs/common';
import { BackgroundResearchSource, RawProviderSignals } from './background.tokens';

/**
 * Stub ratings/search source. Returns no external signals — the research service
 * falls back to model-derived signals for now. Replace with a real ratings /
 * search API behind the `BACKGROUND_RESEARCH_SOURCE` token. Do not scrape.
 */
@Injectable()
export class StubBackgroundResearchSource implements BackgroundResearchSource {
  async lookup(_args: { subjectProviderName: string; regionHint?: string | null }): Promise<RawProviderSignals> {
    // TODO: call a real ratings/review/search API and map its response here.
    return { sources: [] };
  }
}

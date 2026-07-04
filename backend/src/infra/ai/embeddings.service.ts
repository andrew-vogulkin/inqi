import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { EmbeddingsDriver, UsageKind } from '@inqi/shared';
import { ConfigService } from '../config/config.service';
import { UsageService } from '../usage/usage.service';
import { UsageContextService } from '../usage/usage-context.service';
import { EmbeddingsProvider } from './ai.tokens';

/** FNV-1a 32-bit hash, used for deterministic feature hashing. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Embeddings for subject similarity / prior-report reuse. Calls an OpenAI-
 * compatible `/embeddings` endpoint when configured; otherwise falls back to a
 * deterministic feature-hash embedding so reuse works offline (same text →
 * same vector; shared tokens → closer cosine). Bound to `EMBEDDINGS_PROVIDER`.
 */
@Injectable()
export class EmbeddingsService implements EmbeddingsProvider {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly dim: number;
  private readonly driver: EmbeddingsDriver;

  constructor(
    private readonly config: ConfigService,
    private readonly usage: UsageService,
    private readonly usageCtx: UsageContextService,
  ) {
    const { apiKey, baseUrl, model, dim } = this.config.embeddings;
    this.client = new OpenAI({ apiKey: apiKey ?? 'unset', baseURL: baseUrl });
    this.model = model;
    this.dim = dim;
    this.driver = this.config.embeddingsDriver;
  }

  async embed({ text }: { text: string }): Promise<number[]> {
    const reportId = this.usageCtx.reportId();
    if (this.driver === EmbeddingsDriver.OpenAI) {
      try {
        const r = await this.client.embeddings.create({ model: this.model, input: text });
        const vec = r.data[0]?.embedding;
        if (vec?.length) {
          await this.usage.recordAi({ reportId, kind: UsageKind.Embedding, model: this.model, totalTokens: r.usage?.total_tokens ?? 0, estimated: !r.usage });
          return vec as number[];
        }
      } catch (e) {
        this.logger.warn(`embeddings call failed, using local fallback: ${(e as Error).message}`);
      }
    }
    // Local deterministic fallback — still a counted embedding op (cost 0), tokens estimated.
    await this.usage.recordAi({ reportId, kind: UsageKind.Embedding, model: 'local-feature-hash', totalTokens: 0, estimated: true });
    return this.localEmbedding(text);
  }

  /** Deterministic, L2-normalized feature-hash embedding of dimension `dim`. */
  private localEmbedding(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const token of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      v[hash(token) % this.dim] += 1;
    }
    const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

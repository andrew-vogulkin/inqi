import { UsageKind } from '@inqi/shared';
import type { PriceTable } from '../config/config.service';

/** Minimal ledger-row shape the rollup needs (subset of UsageRecord). */
export interface UsageRow {
  kind: string;
  model?: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  quantity: number;
}

export interface PerModelCost { model: string; promptTokens: number; completionTokens: number; estUsd: number }

export interface CostSummary {
  currency: string;
  perModel: PerModelCost[];
  outreach: { emails: number; replies: number; discovery: number; research: number; embeddings: number; estUsd: number };
  tokenTotal: number;
  grandTotalUsd: number;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Pure cost rollup (HP-15): per-model token totals + $ (from the config price
 * table), outreach action counts + $, token grand total, and the grand total $.
 * Unknown models / missing prices cost 0; missing token usage simply contributes 0.
 */
export function rollupCost({ usageRecords, priceTable }: { usageRecords: UsageRow[]; priceTable: PriceTable }): CostSummary {
  const perModelAgg = new Map<string, { prompt: number; completion: number }>();
  let tokenTotal = 0;

  for (const r of usageRecords) {
    if (r.kind === UsageKind.AiCall) {
      const model = r.model ?? 'unknown';
      const agg = perModelAgg.get(model) ?? { prompt: 0, completion: 0 };
      agg.prompt += r.promptTokens;
      agg.completion += r.completionTokens;
      perModelAgg.set(model, agg);
      tokenTotal += r.totalTokens || r.promptTokens + r.completionTokens;
    } else if (r.kind === UsageKind.Embedding) {
      tokenTotal += r.totalTokens;
    }
  }

  const perModel: PerModelCost[] = [...perModelAgg.entries()].map(([model, { prompt, completion }]) => {
    const price = priceTable.models[model] ?? { promptPer1k: 0, completionPer1k: 0 };
    return { model, promptTokens: prompt, completionTokens: completion, estUsd: round((prompt / 1000) * price.promptPer1k + (completion / 1000) * price.completionPer1k) };
  });

  const count = (kind: UsageKind) => usageRecords.filter((r) => r.kind === kind).reduce((s, r) => s + (r.quantity || 1), 0);
  const emails = count(UsageKind.EmailSent);
  const replies = count(UsageKind.ReplyProcessed);
  const discovery = count(UsageKind.DiscoveryCall);
  const research = count(UsageKind.BackgroundResearch);
  const embeddings = count(UsageKind.Embedding);

  const outreachUsd = round(
    emails * priceTable.perEmail + replies * priceTable.perReplyProcessed + discovery * priceTable.perDiscoveryCall +
    research * priceTable.perBackgroundResearch + embeddings * priceTable.perEmbedding,
  );
  const modelUsd = perModel.reduce((s, m) => s + m.estUsd, 0);

  return {
    currency: priceTable.currency,
    perModel,
    outreach: { emails, replies, discovery, research, embeddings, estUsd: outreachUsd },
    tokenTotal,
    grandTotalUsd: round(modelUsd + outreachUsd),
  };
}

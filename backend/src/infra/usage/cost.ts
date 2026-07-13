import { UsageKind, WebSearchSource } from '@inqi/shared';
import type { PriceTable } from '../config/config.service';

/** Minimal ledger-row shape the rollup needs (subset of UsageRecord). */
export interface UsageRow {
  kind: string;
  model?: string | null;
  source?: string | null;
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
  /** Every web search the pipeline fired (breadth cycles, marketing pass, depth leads/tools), by provider,
   *  with a per-phase breakdown (subject build / breadth / depth / resource get). */
  webSearch: { calls: number; provider: string; estUsd: number; bySource: { source: WebSearchSource; calls: number }[] };
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

  const searchRows = usageRecords.filter((r) => r.kind === UsageKind.WebSearch);
  const searchCalls = searchRows.reduce((s, r) => s + (r.quantity || 1), 0);
  // Provider label rides the rows' `model` column ('searxng' today; a hosted API later).
  const providers = [...new Set(searchRows.map((r) => r.model).filter(Boolean))] as string[];
  // Per-phase breakdown: which pipeline stage fired each search (rows predating
  // source-tracking fall into `other`). Emitted in a stable phase order.
  const sourceAgg = new Map<WebSearchSource, number>();
  for (const r of searchRows) {
    const src = (r.source as WebSearchSource) ?? WebSearchSource.Other;
    sourceAgg.set(src, (sourceAgg.get(src) ?? 0) + (r.quantity || 1));
  }
  const SOURCE_ORDER: WebSearchSource[] = [
    WebSearchSource.SubjectBuild, WebSearchSource.BreadthSearch, WebSearchSource.DepthSearch, WebSearchSource.ResourceGet, WebSearchSource.Other,
  ];
  const bySource = SOURCE_ORDER.filter((s) => sourceAgg.has(s)).map((source) => ({ source, calls: sourceAgg.get(source)! }));
  const webSearch = {
    calls: searchCalls,
    provider: providers.join(', ') || 'searxng',
    estUsd: round(searchCalls * (priceTable.perWebSearch ?? 0)),
    bySource,
  };

  const modelUsd = perModel.reduce((s, m) => s + m.estUsd, 0);

  return {
    currency: priceTable.currency,
    perModel,
    outreach: { emails, replies, discovery, research, embeddings, estUsd: outreachUsd },
    webSearch,
    tokenTotal,
    grandTotalUsd: round(modelUsd + outreachUsd + webSearch.estUsd),
  };
}

import { CostSummaryDto } from '../api/types';

/**
 * FE-13 — per-report cost rollup derivation (pure selector; convention #2/#5). The
 * grand total must reconcile: Σ perModel.estUsd + outreach.estUsd === grandTotalUsd.
 */

/** Friendly labels for the web-search per-phase breakdown (keyed by WebSearchSource). */
export const WEB_SEARCH_SOURCE_LABEL: Record<string, string> = {
  subject_build: 'Subject build',
  breadth_search: 'Breadth search',
  depth_search: 'Depth search',
  resource_get: 'Resource get',
  other: 'Other',
};

/** The three summary tiles. */
export const CostMetric = {
  Total: 'total',
  Tokens: 'tokens',
  Outreach: 'outreach',
} as const;
export type CostMetric = (typeof CostMetric)[keyof typeof CostMetric];

export const COST_METRIC_LABEL: Record<CostMetric, string> = {
  [CostMetric.Total]: 'Total cost',
  [CostMetric.Tokens]: 'LLM tokens',
  [CostMetric.Outreach]: 'Outreach actions',
};

/** Outreach line items (keys match OutreachCostDto). */
export const OutreachAction = {
  Emails: 'emails',
  Replies: 'replies',
  Discovery: 'discovery',
  Research: 'research',
  Embeddings: 'embeddings',
} as const;
export type OutreachAction = (typeof OutreachAction)[keyof typeof OutreachAction];

export const OUTREACH_ACTION_LABEL: Record<OutreachAction, string> = {
  [OutreachAction.Emails]: 'Emails sent',
  [OutreachAction.Replies]: 'Replies received',
  [OutreachAction.Discovery]: 'Discovery searches',
  [OutreachAction.Research]: 'Research lookups',
  [OutreachAction.Embeddings]: 'Embeddings',
};

const OUTREACH_ACTIONS: OutreachAction[] = [
  OutreachAction.Emails, OutreachAction.Replies, OutreachAction.Discovery, OutreachAction.Research, OutreachAction.Embeddings,
];

export interface PerModelRow { model: string; promptTokens: number; completionTokens: number; estUsd: number }
export interface OutreachRow { action: OutreachAction; count: number }

export interface CostView {
  currency: string;
  totalUsd: number;
  tokenTotal: number;
  outreachActions: number;
  perModel: PerModelRow[];
  outreach: OutreachRow[];
  outreachUsd: number;
  /** Every web search fired for the report, with the serving provider (searxng / a hosted API)
   *  and a per-phase breakdown (subject build / breadth / depth / resource get). */
  webSearch: { calls: number; provider: string; estUsd: number; bySource: { source: string; calls: number }[] };
  sumUsd: number;       // Σ perModel.estUsd + outreach.estUsd + webSearch.estUsd
  reconciles: boolean;  // |sumUsd − totalUsd| < epsilon
}

const EPSILON = 1e-6;

/** Derive tiles + line items from the cost DTO, with the reconciliation check. */
export function deriveCostView({ cost }: { cost: CostSummaryDto }): CostView {
  const perModelUsd = cost.perModel.reduce((acc, m) => acc + m.estUsd, 0);
  // Back-compat: a cached/old payload without webSearch (or without the per-source
  // breakdown) still renders — missing pieces read as empty/zero.
  const rawWs = cost.webSearch ?? { calls: 0, provider: 'searxng', estUsd: 0, bySource: [] };
  const webSearch = { ...rawWs, bySource: rawWs.bySource ?? [] };
  const sumUsd = perModelUsd + cost.outreach.estUsd + webSearch.estUsd;
  const outreach = OUTREACH_ACTIONS.map((action) => ({ action, count: cost.outreach[action] }));
  const outreachActions = outreach.reduce((acc, r) => acc + r.count, 0);
  return {
    currency: cost.currency,
    totalUsd: cost.grandTotalUsd,
    tokenTotal: cost.tokenTotal,
    outreachActions,
    perModel: cost.perModel.map((m) => ({ model: m.model, promptTokens: m.promptTokens, completionTokens: m.completionTokens, estUsd: m.estUsd })),
    outreach,
    outreachUsd: cost.outreach.estUsd,
    webSearch,
    sumUsd,
    reconciles: Math.abs(sumUsd - cost.grandTotalUsd) < EPSILON,
  };
}

/** Format money to 4dp (Geist Mono in the view); `$` for USD, else the currency code. */
export function formatUsd({ amount, currency }: { amount: number; currency: string }): string {
  const n = amount.toFixed(4);
  return currency === 'USD' ? `$${n}` : `${currency} ${n}`;
}

/** Integer with thousands separators (deterministic, locale-independent). */
export function formatInt({ value }: { value: number }): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

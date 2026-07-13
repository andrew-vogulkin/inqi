import { UsageKind, WebSearchSource } from '@inqi/shared';
import type { PriceTable } from '../config/config.service';
import { rollupCost, UsageRow } from './cost';

const prices: PriceTable = {
  currency: 'USD',
  models: { 'qwen-plus': { promptPer1k: 0.001, completionPer1k: 0.002 }, qwen: { promptPer1k: 0, completionPer1k: 0 } },
  perEmail: 0.01, perEmbedding: 0.0001, perDiscoveryCall: 0, perBackgroundResearch: 0, perReplyProcessed: 0, perWebSearch: 0.0005,
};
const ai = (model: string, p: number, c: number, est = false): UsageRow => ({ kind: UsageKind.AiCall, model, promptTokens: p, completionTokens: c, totalTokens: p + c, quantity: 1 });
const act = (kind: UsageKind, q = 1): UsageRow => ({ kind, promptTokens: 0, completionTokens: 0, totalTokens: 0, quantity: q });

describe('rollupCost', () => {
  it('computes per-model token totals + $ from the price table', () => {
    const s = rollupCost({ usageRecords: [ai('qwen-plus', 1000, 500), ai('qwen-plus', 1000, 0)], priceTable: prices });
    const m = s.perModel.find((x) => x.model === 'qwen-plus')!;
    expect(m.promptTokens).toBe(2000);
    expect(m.completionTokens).toBe(500);
    // 2000/1000*0.001 + 500/1000*0.002 = 0.002 + 0.001 = 0.003
    expect(m.estUsd).toBeCloseTo(0.003, 6);
  });

  it('prices the local model at 0 and unknown models at 0', () => {
    const s = rollupCost({ usageRecords: [ai('qwen', 5000, 5000), ai('mystery', 1000, 1000)], priceTable: prices });
    expect(s.perModel.find((m) => m.model === 'qwen')!.estUsd).toBe(0);
    expect(s.perModel.find((m) => m.model === 'mystery')!.estUsd).toBe(0);
  });

  it('counts outreach actions and prices them', () => {
    const s = rollupCost({ usageRecords: [act(UsageKind.EmailSent), act(UsageKind.EmailSent), act(UsageKind.ReplyProcessed), act(UsageKind.Embedding, 3), act(UsageKind.DiscoveryCall), act(UsageKind.BackgroundResearch)], priceTable: prices });
    expect(s.outreach).toMatchObject({ emails: 2, replies: 1, discovery: 1, research: 1, embeddings: 3 });
    // 2*0.01 + 3*0.0001 = 0.0203
    expect(s.outreach.estUsd).toBeCloseTo(0.0203, 6);
  });

  it('grand total sums model + outreach $; token total includes ai + embedding tokens', () => {
    const s = rollupCost({ usageRecords: [ai('qwen-plus', 1000, 1000), { kind: UsageKind.Embedding, promptTokens: 0, completionTokens: 0, totalTokens: 50, quantity: 1 }, act(UsageKind.EmailSent)], priceTable: prices });
    expect(s.tokenTotal).toBe(2050);
    // model: 1000/1000*0.001 + 1000/1000*0.002 = 0.003 ; outreach: email 1*0.01 + embedding 1*0.0001 = 0.0101
    expect(s.grandTotalUsd).toBeCloseTo(0.0131, 6);
  });

  it('handles missing-usage AI rows (0 tokens) without error', () => {
    const s = rollupCost({ usageRecords: [ai('qwen', 0, 0, true)], priceTable: prices });
    expect(s.tokenTotal).toBe(0);
    expect(s.grandTotalUsd).toBe(0);
  });
});

describe('rollupCost — web searches (HP-15 extension)', () => {
  const search = (q = 1, model = 'searxng', source?: string): UsageRow => ({ kind: UsageKind.WebSearch, model, source, promptTokens: 0, completionTokens: 0, totalTokens: 0, quantity: q });

  it('counts calls, carries the provider label, and prices per call into the grand total', () => {
    const s = rollupCost({ usageRecords: [search(), search(), search(3)], priceTable: prices });
    // No source on these rows → they aggregate under `other`.
    expect(s.webSearch).toEqual({ calls: 5, provider: 'searxng', estUsd: 0.0025, bySource: [{ source: WebSearchSource.Other, calls: 5 }] });
    expect(s.grandTotalUsd).toBeCloseTo(0.0025, 6);
  });

  it('no searches → zero row with the default provider label and empty breakdown', () => {
    const s = rollupCost({ usageRecords: [], priceTable: prices });
    expect(s.webSearch).toEqual({ calls: 0, provider: 'searxng', estUsd: 0, bySource: [] });
  });

  it('mixed providers join their labels', () => {
    const s = rollupCost({ usageRecords: [search(1, 'searxng'), search(1, 'brave')], priceTable: prices });
    expect(s.webSearch.provider).toBe('searxng, brave');
  });

  it('breaks the count down by phase source, in stable phase order', () => {
    const s = rollupCost({
      usageRecords: [
        search(2, 'searxng', WebSearchSource.DepthSearch),
        search(3, 'searxng', WebSearchSource.BreadthSearch),
        search(1, 'searxng', WebSearchSource.ResourceGet),
        search(1, 'searxng', WebSearchSource.BreadthSearch),
      ],
      priceTable: prices,
    });
    expect(s.webSearch.calls).toBe(7);
    // Emitted subject_build → breadth → depth → resource_get → other.
    expect(s.webSearch.bySource).toEqual([
      { source: WebSearchSource.BreadthSearch, calls: 4 },
      { source: WebSearchSource.DepthSearch, calls: 2 },
      { source: WebSearchSource.ResourceGet, calls: 1 },
    ]);
  });
});

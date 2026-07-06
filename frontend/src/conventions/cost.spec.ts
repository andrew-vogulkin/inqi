import { describe, it, expect } from 'vitest';
import { CostSummaryDto } from '../api/types';
import { deriveCostView, formatUsd, formatInt, OutreachAction } from './cost';

const cost = (over: Partial<CostSummaryDto> = {}): CostSummaryDto => ({
  currency: 'USD',
  perModel: [
    { model: 'qwen', promptTokens: 1000, completionTokens: 500, estUsd: 0.15 },
    { model: 'embed', promptTokens: 2000, completionTokens: 0, estUsd: 0.05 },
  ],
  outreach: { emails: 3, replies: 1, discovery: 2, research: 4, embeddings: 10, estUsd: 0.30 },
  tokenTotal: 3500,
  grandTotalUsd: 0.50,
  ...over,
});

describe('deriveCostView — tiles + reconciliation', () => {
  it('derives tiles and line items', () => {
    const v = deriveCostView({ cost: cost() });
    expect(v.totalUsd).toBe(0.5);
    expect(v.tokenTotal).toBe(3500);
    expect(v.outreachActions).toBe(3 + 1 + 2 + 4 + 10); // 20
    expect(v.perModel).toHaveLength(2);
    expect(v.outreach.map((r) => r.action)).toEqual([
      OutreachAction.Emails, OutreachAction.Replies, OutreachAction.Discovery, OutreachAction.Research, OutreachAction.Embeddings,
    ]);
  });

  it('reconciles when Σ line items === grand total', () => {
    const v = deriveCostView({ cost: cost() }); // 0.15 + 0.05 + 0.30 = 0.50
    expect(v.sumUsd).toBeCloseTo(0.5, 6);
    expect(v.reconciles).toBe(true);
  });

  it('flags a mismatch when the grand total does not reconcile', () => {
    const v = deriveCostView({ cost: cost({ grandTotalUsd: 0.99 }) });
    expect(v.reconciles).toBe(false);
  });
});

describe('formatters', () => {
  it('formats USD with $ and 4dp, other currencies with a code', () => {
    expect(formatUsd({ amount: 0.5, currency: 'USD' })).toBe('$0.5000');
    expect(formatUsd({ amount: 1.2, currency: 'EUR' })).toBe('EUR 1.2000');
  });
  it('formats integers with thousands separators', () => {
    expect(formatInt({ value: 3500 })).toBe('3,500');
    expect(formatInt({ value: 999 })).toBe('999');
    expect(formatInt({ value: 1234567 })).toBe('1,234,567');
  });
});

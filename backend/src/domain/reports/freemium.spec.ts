import { redactFreemium } from './reports.service';
import { RankedOption } from './ranking';

const opt = (name: string, score: number): RankedOption => ({
  subjectProvider: name, price: 100, currency: 'EUR', availability: null, leadTime: null,
  qualityScore: score, priceScore: 0.5, score, background: { rating: 4.5 },
});

// Ranked best→worst (rank 1 = best). HP-21 reveals only #5 (or the lowest if <5).
const five = [opt('A', 0.9), opt('B', 0.8), opt('C', 0.7), opt('D', 0.6), opt('E', 0.5)];

describe('redactFreemium (HP-21)', () => {
  it('reveals only the #5-ranked option; top-4 become locked stubs with NO provider data', () => {
    const { options, lockedCount } = redactFreemium(five);
    expect(lockedCount).toBe(4);
    const revealed = options.filter((o) => (o as { locked?: boolean }).locked === false);
    expect(revealed).toHaveLength(1);
    expect((revealed[0] as { subjectProvider: string }).subjectProvider).toBe('E'); // the #5
    // The hidden options carry ONLY id/locked/rank — never provider/price/quality.
    const locked = options.filter((o) => (o as { locked?: boolean }).locked === true);
    expect(locked).toHaveLength(4);
    for (const l of locked) {
      expect(Object.keys(l as object).sort()).toEqual(['id', 'locked', 'rank']);
      expect((l as Record<string, unknown>).subjectProvider).toBeUndefined();
      expect((l as Record<string, unknown>).price).toBeUndefined();
    }
    // No revealed top-4 provider name leaks anywhere in the payload.
    const blob = JSON.stringify(options);
    for (const name of ['A', 'B', 'C', 'D']) expect(blob).not.toContain(`"subjectProvider":"${name}"`);
  });

  it('reveals the lowest-ranked option when there are fewer than 5', () => {
    const three = [opt('A', 0.9), opt('B', 0.8), opt('C', 0.7)];
    const { options, lockedCount } = redactFreemium(three);
    expect(lockedCount).toBe(2);
    const revealed = options.filter((o) => (o as { locked?: boolean }).locked === false);
    expect((revealed[0] as { subjectProvider: string }).subjectProvider).toBe('C');
  });

  it('handles an empty option set', () => {
    expect(redactFreemium([])).toEqual({ options: [], lockedCount: 0 });
  });

  it('preserves rank order across locked stubs + the revealed option', () => {
    const { options } = redactFreemium(five);
    expect(options.map((o) => (o as { rank: number }).rank)).toEqual([1, 2, 3, 4, 5]);
  });
});

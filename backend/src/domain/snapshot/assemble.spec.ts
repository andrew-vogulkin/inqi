import { FindingKind } from '@inqi/shared';
import { assembleOptions, FindingLike } from './snapshots.service';

const opt = (inquiryId: string, subjectProvider: string, price: number): FindingLike =>
  ({ kind: FindingKind.Option, inquiryId, data: { subjectProvider, price, currency: 'EUR' } });
const bg = (inquiryId: string, qualityScore: number): FindingLike =>
  ({ kind: FindingKind.SubjectProviderBackground, inquiryId, data: { qualityScore, rating: 4.5 } });

describe('assembleOptions', () => {
  it('merges background into the option by inquiry and exposes qualityScore', () => {
    const [o] = assembleOptions([opt('s1', 'Acme', 500), bg('s1', 0.9)]);
    expect(o.subjectProvider).toBe('Acme');
    expect(o.qualityScore).toBe(0.9);
    expect(o.background).not.toBeNull();
  });

  it('ranks by blended quality+price (higher quality / lower price first)', () => {
    const ranked = assembleOptions([
      opt('s1', 'Pricey', 900), bg('s1', 0.95),
      opt('s2', 'Cheap', 100), bg('s2', 0.2),
    ]);
    // Each has a blended score; the assembler returns them sorted desc by score.
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it('handles an option with no background (qualityScore 0)', () => {
    const [o] = assembleOptions([opt('s9', 'NoBg', 300)]);
    expect(o.qualityScore).toBe(0);
    expect(o.background).toBeNull();
  });

  it('returns [] when there are no option findings', () => {
    expect(assembleOptions([bg('s1', 0.5)])).toEqual([]);
  });
});

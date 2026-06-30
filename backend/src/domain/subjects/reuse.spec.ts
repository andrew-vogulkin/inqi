import { decideReuse, ReuseThresholds } from './reuse';

const T: ReuseThresholds = { similarityThreshold: 0.15, radiusMeters: 50_000, freshnessDays: 90 };

describe('decideReuse', () => {
  it('reuses a similar, near, fresh report', () => {
    expect(decideReuse({ candidate: { distance: 0.05, distanceMeters: 10_000, ageDays: 10 }, thresholds: T })).toBe(true);
  });

  it('rejects a dissimilar report (cosine over threshold)', () => {
    expect(decideReuse({ candidate: { distance: 0.2, distanceMeters: 10_000, ageDays: 10 }, thresholds: T })).toBe(false);
  });

  it('treats distance exactly at the threshold as a miss (strict <)', () => {
    expect(decideReuse({ candidate: { distance: 0.15, distanceMeters: 10_000, ageDays: 10 }, thresholds: T })).toBe(false);
  });

  it('rejects a far report (outside the geo radius)', () => {
    expect(decideReuse({ candidate: { distance: 0.05, distanceMeters: 80_000, ageDays: 10 }, thresholds: T })).toBe(false);
  });

  it('rejects a stale report (older than the freshness window)', () => {
    expect(decideReuse({ candidate: { distance: 0.05, distanceMeters: 10_000, ageDays: 120 }, thresholds: T })).toBe(false);
  });

  it('allows a report exactly at the freshness boundary', () => {
    expect(decideReuse({ candidate: { distance: 0.05, distanceMeters: 10_000, ageDays: 90 }, thresholds: T })).toBe(true);
  });

  it('does not enforce geo when distanceMeters is unknown', () => {
    expect(decideReuse({ candidate: { distance: 0.05, distanceMeters: null, ageDays: 10 }, thresholds: T })).toBe(true);
  });
});

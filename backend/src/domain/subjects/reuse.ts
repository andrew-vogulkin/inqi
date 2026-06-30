/**
 * Prior-report reuse decision — the pure rule deciding whether a candidate prior
 * report is close enough (semantically + geographically) and fresh enough to be
 * reused instead of redoing research. Kept free of I/O so it's unit-testable in
 * isolation; the repository supplies the raw metrics, this function decides.
 */

/** Config-driven thresholds (from `config.reuse`). */
export interface ReuseThresholds {
  /** Max cosine distance (lower = more similar); candidate must be strictly below. */
  similarityThreshold: number;
  /** Max geo distance in meters; ignored when the candidate/inquiry has no geo. */
  radiusMeters: number;
  /** Max report age in days; older reports are too stale to reuse. */
  freshnessDays: number;
}

/** Raw metrics for one candidate prior report. */
export interface ReuseCandidate {
  /** pgvector cosine distance between the two subjects (lower = more similar). */
  distance: number;
  /** PostGIS distance in meters, or null when either side lacks geo. */
  distanceMeters: number | null;
  /** Age of the prior report in days. */
  ageDays: number;
}

/**
 * True when the candidate clears all three dimensions: semantically similar
 * (cosine < threshold), within the geo radius (when geo is known), and fresh
 * (within the freshness window). Geo is only enforced when `distanceMeters` is
 * known — a missing point doesn't disqualify a strong semantic + fresh match.
 */
export function decideReuse({ candidate, thresholds }: { candidate: ReuseCandidate; thresholds: ReuseThresholds }): boolean {
  if (!(candidate.distance < thresholds.similarityThreshold)) return false;
  if (candidate.ageDays > thresholds.freshnessDays) return false;
  if (candidate.distanceMeters != null && candidate.distanceMeters > thresholds.radiusMeters) return false;
  return true;
}

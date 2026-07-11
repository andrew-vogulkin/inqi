import { SearchFocus } from '@inqi/shared';

/**
 * A golden rehearsal case: a report request plus the outcome we assert. The scorer
 * (S3) checks a finished run against these; the runner (S4) replays the case's
 * cassette so the model is judged on identical evidence. Every field is checkable
 * from the delivered snapshot — no human grading needed for the pass/fail gate.
 */
export interface CaseExpectations {
  /** Provider names that MUST appear as options (case-insensitive substring match). */
  mustQualify?: string[];
  /** Provider names that MUST NOT appear (no fabrication / correct disqualification). */
  mustDrop?: string[];
  /** The report must end FAILED with no fabricated providers (over-broad / no real supply). */
  mustFailGracefully?: boolean;
  /** The request must be refused by the compliance gate (DENIED, no options). */
  mustDeny?: boolean;
  /** Inclusive bounds on the delivered option count. */
  minOptions?: number;
  maxOptions?: number;
}

/** Per-phase expectations for the NARROW drivers (docs/research-phase-evolution.md item 3). */
export interface BreadthExpectations {
  minCandidates?: number;
  /** Names the discovery must surface (case-insensitive substring). */
  mustSurface?: string[];
}
export interface DepthExpectations {
  /** The inquiry the depth driver investigates (one provider per case). */
  fixture?: { provider: string; regionHint?: string | null; knownFacts?: { website?: string | null } };
  minSources?: number;
  qualityAtLeast?: number;
}

export interface RehearsalCase {
  /** Stable id — also the cassette filename and the run label. */
  id: string;
  rawRequest: string;
  geo?: { lat?: number; lng?: number; label?: string } | null;
  focus?: SearchFocus | null;
  /** Why this case exists (what regression / behaviour it pins). */
  note: string;
  expectations: CaseExpectations;
  /** Optional per-phase expectations — cases without them are full-pipeline only. */
  breadth?: BreadthExpectations;
  depth?: DepthExpectations;
}

/** Reject a malformed case early — a golden set must be trustworthy. */
export function validateCase(c: RehearsalCase): RehearsalCase {
  if (!/^[\w.-]+$/.test(c.id)) throw new Error(`rehearsal case id must be filename-safe: ${c.id}`);
  if (!c.rawRequest.trim()) throw new Error(`rehearsal case ${c.id} has an empty rawRequest`);
  const e = c.expectations;
  const hasAssertion = !!(e.mustQualify?.length || e.mustDrop?.length || e.mustFailGracefully || e.mustDeny || e.minOptions != null || e.maxOptions != null);
  if (!hasAssertion) throw new Error(`rehearsal case ${c.id} asserts nothing`);
  if (e.minOptions != null && e.maxOptions != null && e.minOptions > e.maxOptions) {
    throw new Error(`rehearsal case ${c.id}: minOptions > maxOptions`);
  }
  if (e.mustFailGracefully && e.mustDeny) {
    throw new Error(`rehearsal case ${c.id}: mustFailGracefully and mustDeny are mutually exclusive`);
  }
  // A terminal-negative outcome (fail / deny) can't also assert positive options.
  if ((e.mustFailGracefully || e.mustDeny) && (e.mustQualify?.length || e.minOptions != null || e.maxOptions != null)) {
    throw new Error(`rehearsal case ${c.id}: fail/deny conflicts with mustQualify/min/maxOptions`);
  }
  return c;
}

import { SubjectCategory } from '@inqi/shared';

/** The evolving subject the operators fill/refine (lives under PhaseRun.data). */
export interface SubjectDraft {
  title?: string;
  category?: string;      // SubjectCategory
  summary?: string;       // → Subject.description
  attributes?: Record<string, unknown>;
  interpretation?: string;
  reusedFrom?: string;    // prior ReportSnapshot id, if adapted
  confidence?: number;    // 0..1
}

/** What past builds of the request's domain learned (loaded by domain-recall). */
export interface DomainPriorsData {
  attributes: Record<string, unknown>;
  sources: string[];
  titleHints: string[];
  buildCount: number;
  category?: string | null;
}

/** The full subject_build run scratchpad (PhaseRun.data — the network's shared blackboard). */
export interface SubjectBuildData {
  rawRequest: string;
  enriched?: { title?: string; category?: string; summary?: string };
  draft: SubjectDraft;
  evidence?: { url: string; snippet: string }[];
  referenceSet?: string[];
  toolset?: string[];
  domain?: string;               // resolved domain label (domain-recall)
  domainPriors?: DomainPriorsData; // the domain's accumulated memory (domain-recall)
  stepCount: number;             // operators executed so far — the runtime operator-budget guard reads this
  notes: string[];
}

/** Fresh run data seeded at SUBJECT_IN. */
export function initSubjectBuildData({ rawRequest, enriched }: { rawRequest: string; enriched?: SubjectBuildData['enriched'] }): SubjectBuildData {
  return { rawRequest, enriched, draft: {}, stepCount: 0, notes: [] };
}

/**
 * The persist invariant (SUBJECT_OUT). STRICT on purpose: the whole point of the
 * slot is to do better than the naive `rawRequest.slice(0,80)` fallback, so OUT
 * only persists when the operators actually produced a title, summary and category.
 * A composition that didn't → STEP_FAILED (rejected), never a silent fallback.
 */
export function isInvariantMet(draft: SubjectDraft): boolean {
  return !!(draft.title?.trim() && draft.summary?.trim() && draft.category);
}

/** Map a satisfied draft to the Subject aggregate fields (createFromReport input). */
export function draftToSubject({ draft, rawRequest }: { draft: SubjectDraft; rawRequest: string }): { title: string; description: string; category: string } {
  return {
    title: draft.title?.trim() || rawRequest.slice(0, 80),
    description: draft.summary?.trim() || rawRequest,
    category: draft.category || SubjectCategory.Item,
  };
}

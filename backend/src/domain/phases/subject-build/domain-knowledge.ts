import { REFERENCE_SETS } from './reference-sets';
import { DomainPriorsData, SubjectBuildData } from './draft';

/**
 * The subject_build network's persistent memory over DOMAINS of subjects
 * (weddings, trades, collectibles, …). `domain-recall` reads it at the top of
 * the network; `domain-learn` writes the finished draft back at the bottom —
 * so every built Subject improves the next build of its domain. Pure logic
 * lives here; persistence is injected (Prisma in production, a sink in tests
 * and rehearsals — an experiment must never pollute the memory).
 */

/** What past builds of a domain learned (the `DomainKnowledge` row, sans ids). */
export type DomainPriors = DomainPriorsData;

export const EMPTY_PRIORS: DomainPriors = { attributes: {}, sources: [], titleHints: [], buildCount: 0 };

/** Caps — the memory summarises a domain, it does not archive it. */
const MAX_SOURCES = 16;
const MAX_TITLE_HINTS = 12;

/**
 * Resolve the domain label for a request: the matching curated reference-set
 * label, else a learned per-category slug, else null (no memory for this run).
 */
export function resolveDomainLabel({ rawRequest, category }: { rawRequest: string; category?: string | null }): string | null {
  const hay = `${category ?? ''} ${rawRequest}`;
  const curated = REFERENCE_SETS.find((s) => s.match.test(hay))?.label;
  if (curated) return curated;
  return category ? `${category}-general` : null;
}

const dedupeCap = (xs: string[], cap: number): string[] => [...new Set(xs.filter(Boolean))].slice(0, cap);

/** A URL's host (evidence → learned source), or null for junk. */
function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

/**
 * Fold one finished build into the domain's memory: union attributes (new keys
 * win — fresher evidence), learn evidence hosts + the run's reference set as
 * sources, keep the title as an exemplar, bump buildCount. Pure — the caller
 * persists the result.
 */
export function mergeDomainKnowledge({ prior, data }: { prior: DomainPriors | null; data: SubjectBuildData }): DomainPriors {
  const p = prior ?? EMPTY_PRIORS;
  const evidenceHosts = (data.evidence ?? []).map((e) => hostOf(e.url)).filter((h): h is string => !!h);
  return {
    attributes: { ...p.attributes, ...(data.draft.attributes ?? {}) },
    sources: dedupeCap([...p.sources, ...evidenceHosts, ...(data.referenceSet ?? [])], MAX_SOURCES),
    titleHints: dedupeCap([...(data.draft.title ? [data.draft.title] : []), ...p.titleHints], MAX_TITLE_HINTS),
    buildCount: p.buildCount + 1,
    category: data.draft.category ?? p.category ?? null,
  };
}

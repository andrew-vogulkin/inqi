import { OutreachOutcome, ProvenanceDto, ProvenanceDepth, ProvenanceSummaries } from '@inqi/shared';
import { ResearchDepth, ResearchMethod, OutreachVariant } from './enums';
import { ReportOption } from '../api/types';

/** The server provenance depth enum (PascalCase) → the FE ResearchDepth enum (snake_case). */
const PROVENANCE_DEPTH: Record<ProvenanceDepth, ResearchDepth> = {
  [ProvenanceDepth.WebOnly]: ResearchDepth.WebOnly,
  [ProvenanceDepth.WebFeedback]: ResearchDepth.WebFeedback,
  [ProvenanceDepth.WebOutreachFeedback]: ResearchDepth.WebOutreachFeedback,
};

/** Translate a server provenance depth to the FE depth (falls back to web-only on an unknown value). */
export function depthFromProvenance(depth: ProvenanceDepth): ResearchDepth {
  return PROVENANCE_DEPTH[depth] ?? ResearchDepth.WebOnly;
}

/** A web source on the option background — either a bare URL/name or a {source,url,snippet} record. */
export type BackgroundSource = string | { source?: string; url?: string; snippet?: string };

/** Compact subject-provider background carried on a report option (HP report DTO). */
export interface OptionBackground {
  rating?: number | null;
  reviewsCount?: number | null;
  eligibility?: string | null;
  redFlags?: string[];
  sources?: BackgroundSource[];
  qualityScore?: number | null;
}

/** Normalize a background source (string or object) into the dossier's WebSource shape. */
export function toWebSource(s: BackgroundSource): WebSource {
  if (typeof s === 'string') return { source: s };
  return { source: s.source ?? s.url ?? '', url: s.url, snippet: s.snippet };
}

export interface WebSource { source: string; url?: string; snippet?: string }
export interface FeedbackVM { rating: number | null; sentiment: number; themes: string[]; quotes: string[]; reviewsCount: number | null; eligibility: string | null }
export interface OutreachVM { variant: OutreachVariant; route: string; outcome: string | null; persona: string | null }
export interface ScoringVM { feedbackScore: number; priceScore: number; blendedScore: number; rank: number }

export interface DossierVM {
  provider: string;
  rank: number;
  price: { amount: number; currency: string } | null;
  qualityScore: number;
  depth: ResearchDepth;
  methods: ResearchMethod[];
  subtaskId: string | null;
  web: WebSource[];
  feedback: FeedbackVM;
  outreach: OutreachVM;
  scoring: ScoringVM;
  summaries?: ProvenanceSummaries; // HP-20: AI transparency summaries per section (customer provenance only)
}

// ---- pure derivations (unit-tested) ---------------------------------------

/** Depth from which methods produced data. */
export function deriveDepth({ hasWeb, hasOutreach, hasFeedback }: { hasWeb: boolean; hasOutreach: boolean; hasFeedback: boolean }): ResearchDepth {
  if (hasOutreach && hasFeedback) return ResearchDepth.WebOutreachFeedback;
  if (hasFeedback) return ResearchDepth.WebFeedback;
  void hasWeb;
  return ResearchDepth.WebOnly;
}

/** The method badges to show (ordered). */
export function deriveMethods({ hasWeb, hasOutreach, hasFeedback }: { hasWeb: boolean; hasOutreach: boolean; hasFeedback: boolean }): ResearchMethod[] {
  const methods: ResearchMethod[] = [];
  if (hasWeb) methods.push(ResearchMethod.WebSearch);
  if (hasOutreach) methods.push(ResearchMethod.Outreach);
  if (hasFeedback) methods.push(ResearchMethod.FeedbackScan);
  return methods;
}

/** Outreach variant from contact/reply state. */
export function outreachVariant({ contacted, replied }: { contacted: boolean; replied: boolean }): OutreachVariant {
  if (replied) return OutreachVariant.Replied;
  if (contacted) return OutreachVariant.Pending;
  return OutreachVariant.NotContacted;
}

/** Redacted outreach outcome (HP-20) → the FE outreach variant. */
export function outreachVariantFromOutcome(outcome: OutreachOutcome): OutreachVariant {
  if (outcome === OutreachOutcome.Replied) return OutreachVariant.Replied;
  if (outcome === OutreachOutcome.Pending) return OutreachVariant.Pending;
  return OutreachVariant.NotContacted;
}

/**
 * Overlay the authoritative customer-safe provenance (HP-20) onto the option-derived
 * VM — richer web sources + feedback (themes/quotes the compact option drops) + the
 * server's scoring/depth/redacted outreach. Still no chain (provenance is redacted).
 */
export function applyProvenance({ vm, provenance }: { vm: DossierVM; provenance: ProvenanceDto }): DossierVM {
  const hasWeb = provenance.web.length > 0;
  const hasFeedback = provenance.feedback.rating > 0 || provenance.feedback.themes.length > 0;
  const hasOutreach = provenance.outreach.outcome !== OutreachOutcome.NotContacted;
  return {
    ...vm,
    depth: depthFromProvenance(provenance.depth),
    methods: deriveMethods({ hasWeb, hasOutreach, hasFeedback }),
    qualityScore: provenance.scoring.feedbackScore,
    web: provenance.web.map((w) => ({ source: w.source, url: w.url, snippet: w.snippet })),
    feedback: {
      rating: provenance.feedback.rating || null,
      sentiment: provenance.feedback.sentiment,
      themes: provenance.feedback.themes,
      quotes: provenance.feedback.quotes,
      reviewsCount: vm.feedback.reviewsCount,
      eligibility: vm.feedback.eligibility,
    },
    outreach: {
      variant: outreachVariantFromOutcome(provenance.outreach.outcome),
      route: provenance.outreach.route,
      outcome: vm.outreach.outcome,
      persona: provenance.outreach.persona,
    },
    scoring: { feedbackScore: provenance.scoring.feedbackScore, priceScore: provenance.scoring.priceScore, blendedScore: provenance.scoring.blendedScore, rank: provenance.scoring.rank },
    summaries: provenance.summaries,
  };
}

/**
 * Assemble the dossier view-model from a report option (the customer-safe data).
 * Outreach is the redacted summary (variant + outcome) — never the raw chain.
 */
export function assembleDossier({ option, rank }: { option: ReportOption; rank: number }): DossierVM {
  const bg = (option.background ?? {}) as OptionBackground;
  const web: WebSource[] = (bg.sources ?? []).map(toWebSource);
  const themes = bg.redFlags && bg.redFlags.length ? bg.redFlags : [];
  const quality = typeof option.qualityScore === 'number' ? option.qualityScore : (bg.qualityScore ?? 0);

  // Outreach: a reply is implied when availability/outcome is known.
  const contacted = option.availability != null || option.leadTime != null;
  const replied = option.availability != null;
  const variant = outreachVariant({ contacted, replied });

  const hasWeb = web.length > 0;
  const hasFeedback = bg.rating != null || bg.reviewsCount != null;
  const hasOutreach = variant !== OutreachVariant.NotContacted;

  return {
    provider: option.subjectProvider,
    rank,
    price: typeof option.price === 'number' ? { amount: option.price, currency: option.currency ?? '' } : null,
    qualityScore: quality,
    depth: deriveDepth({ hasWeb, hasOutreach, hasFeedback }),
    methods: deriveMethods({ hasWeb, hasOutreach, hasFeedback }),
    subtaskId: option.subtaskId ?? null,
    web,
    feedback: { rating: bg.rating ?? null, sentiment: quality, themes, quotes: [], reviewsCount: bg.reviewsCount ?? null, eligibility: bg.eligibility ?? null },
    outreach: { variant, route: '✉ via inqi', outcome: option.availability ?? null, persona: null },
    scoring: { feedbackScore: quality, priceScore: (option as { priceScore?: number }).priceScore ?? 0, blendedScore: option.score ?? 0, rank },
  };
}

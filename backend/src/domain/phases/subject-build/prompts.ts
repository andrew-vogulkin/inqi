import { z } from 'zod';
import { SubjectCategory } from '@inqi/shared';
import { DomainPriorsData, SubjectDraft } from './draft';

const CATEGORY = z.enum(Object.values(SubjectCategory) as [string, ...string[]]);

/** enrich-basic / -web-grounded → the core subject fields. */
export const draftSchema = z.object({
  title: z.string().min(1),
  category: CATEGORY,
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});
export type DraftOut = z.infer<typeof draftSchema>;

export const specializeSchema = z.object({ attributes: z.record(z.unknown()) });
export const critiqueSchema = draftSchema; // refined title/category/summary
export const disambiguateSchema = z.object({ interpretation: z.string().min(1), ambiguous: z.boolean() });

const CATEGORIES = Object.values(SubjectCategory).join(' | ');
const CATEGORY_RULE = `The category MUST be EXACTLY one of: ${CATEGORIES}. Do not invent other category words.`;

const SUBJECT_RULES =
  'You normalise a customer request into a searchable SUBJECT: a concise title, a category, and a one-line summary. '
  + `Keep the title specific and free of filler; pick the single best category; never invent facts the request does not support. ${CATEGORY_RULE}`;

export function enrichBasicSystem(): string { return SUBJECT_RULES; }
export function enrichBasicUser({ rawRequest, enriched }: { rawRequest: string; enriched?: { title?: string; category?: string; summary?: string } }): string {
  return `Request: ${rawRequest}\n\nFeasibility hints (may be empty): ${JSON.stringify(enriched ?? {})}\n\nReturn { title, category, summary, confidence }.`;
}

export function enrichWebGroundedSystem(): string {
  return `${SUBJECT_RULES} Ground the title/category in what these professional sources would show; prefer concrete, verifiable phrasing.`;
}
export function enrichWebGroundedUser({ rawRequest, referenceSet, evidence, priors }: { rawRequest: string; referenceSet?: string[]; evidence?: { url: string; snippet: string }[]; priors?: DomainPriorsData }): string {
  const memory = priors && priors.buildCount > 0
    ? `\nDomain memory (${priors.buildCount} past builds of this domain): exemplar titles ${JSON.stringify(priors.titleHints.slice(0, 5))}; learned sources ${priors.sources.slice(0, 6).join(', ') || '(none)'}.`
    : '';
  return `Request: ${rawRequest}\n\nPreferred sources: ${(referenceSet ?? []).join(', ') || '(none)'}${memory}\n`
    + `Evidence snippets: ${JSON.stringify((evidence ?? []).slice(0, 6))}\n\nReturn { title, category, summary, confidence } grounded in the evidence.`;
}

export function categorySpecializeSystem(): string {
  return 'Given a subject and its category, extract the attributes a buyer would filter on for THAT category (e.g. a rental: bedrooms, price, area; an item: condition, edition). Return only attributes evidenced by the request.';
}
export function categorySpecializeUser({ draft, rawRequest }: { draft: SubjectDraft; rawRequest: string }): string {
  return `Request: ${rawRequest}\nSubject: ${JSON.stringify({ title: draft.title, category: draft.category })}\n\nReturn { attributes }.`;
}

export function selfCritiqueSystem(): string {
  return `${SUBJECT_RULES} You are given a DRAFT subject; critique it against the request and return an improved title/category/summary. If it is already good, return it unchanged.`;
}
export function selfCritiqueUser({ draft, rawRequest }: { draft: SubjectDraft; rawRequest: string }): string {
  return `Request: ${rawRequest}\nDraft: ${JSON.stringify({ title: draft.title, category: draft.category, summary: draft.summary })}\n\nReturn the improved { title, category, summary, confidence }.`;
}

export function attributeMineSystem(): string {
  return 'Extract the structured attributes a buyer would filter on for this subject (price range, size, condition, location radius, capacity — whatever the request supports). '
    + 'If domain memory lists attribute keys past builds used, prefer filling THOSE keys before inventing new ones. Return only attributes evidenced by the request.';
}
export function attributeMineUser({ rawRequest, draft, priors }: { rawRequest: string; draft: SubjectDraft; priors?: DomainPriorsData }): string {
  const known = priors && Object.keys(priors.attributes).length ? `\nDomain memory attribute keys (from ${priors.buildCount} past builds): ${Object.keys(priors.attributes).slice(0, 12).join(', ')}` : '';
  return `Request: ${rawRequest}\nSubject: ${JSON.stringify({ title: draft.title, category: draft.category })}${known}\n\nReturn { attributes }.`;
}

export function disambiguateSystem(): string {
  return 'Decide whether a request has one clear interpretation or is ambiguous (could mean materially different things). State the interpretation you will proceed with.';
}
export function disambiguateUser({ rawRequest }: { rawRequest: string }): string {
  return `Request: ${rawRequest}\n\nReturn { interpretation, ambiguous }.`;
}

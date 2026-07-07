import { AiProvider } from '../../../infra/ai/ai.tokens';
import { SubjectBuildData, SubjectDraft } from './draft';
import { evalPredicate } from './predicates';
import { referenceSetFor } from './reference-sets';
import {
  categorySpecializeSystem, categorySpecializeUser, critiqueSchema, disambiguateSchema, disambiguateSystem, disambiguateUser,
  draftSchema, enrichBasicSystem, enrichBasicUser, enrichWebGroundedSystem, enrichWebGroundedUser, selfCritiqueSystem, selfCritiqueUser, specializeSchema,
} from './prompts';

/** Only the AI surface the operators use — keeps them easy to fake in tests. */
export type Ai = Pick<AiProvider, 'structured' | 'isConfigured'>;

/** What an operator returns: the event that drives the transition + a patch onto run.data. */
export interface OperatorOutcome {
  event: string;
  draft?: Partial<SubjectDraft>;
  set?: Partial<Pick<SubjectBuildData, 'referenceSet' | 'toolset' | 'evidence'>>;
  note?: string;
}

/** Merge an operator outcome into the run scratchpad; bumps stepCount (the runtime ≤5 guard reads it). */
export function applyOutcome(data: SubjectBuildData, o: OperatorOutcome): SubjectBuildData {
  return {
    ...data,
    draft: { ...data.draft, ...(o.draft ?? {}) },
    ...(o.set ?? {}),
    stepCount: data.stepCount + 1,
    notes: o.note ? [...data.notes, o.note] : data.notes,
  };
}

// --- deterministic operators (pure) ---------------------------------------

export function opTooling({ config }: { config?: Record<string, unknown> }): OperatorOutcome {
  const tools = Array.isArray(config?.tools) ? (config!.tools as string[]) : [];
  return { event: 'BOUND', set: { toolset: tools } };
}

export function opTargetIndustrySet({ data }: { data: SubjectBuildData }): OperatorOutcome {
  return { event: 'SET', set: { referenceSet: referenceSetFor({ rawRequest: data.rawRequest, category: data.draft.category }) } };
}

export function opIfElse({ data, config }: { data: SubjectBuildData; config?: Record<string, unknown> }): OperatorOutcome {
  const id = String(config?.predicate ?? '');
  return { event: evalPredicate({ id, data, config }) ? 'THEN' : 'ELSE' };
}

// --- LLM operators (fail-open, like feasibility) ---------------------------

/** enrich-basic: the model derives title/category/summary; AI down/failed → the naive fallback (today's behaviour). */
export async function opEnrichBasic({ data, ai }: { data: SubjectBuildData; ai: Ai }): Promise<OperatorOutcome> {
  const fallback: OperatorOutcome = {
    event: 'DRAFTED',
    draft: { title: (data.enriched?.title || data.rawRequest.slice(0, 80)), category: data.enriched?.category, summary: data.enriched?.summary || data.rawRequest, confidence: 0.2 },
    note: 'enrich-basic fallback (AI unavailable)',
  };
  if (!ai.isConfigured()) return fallback;
  try {
    const out = await ai.structured({ system: enrichBasicSystem(), user: enrichBasicUser({ rawRequest: data.rawRequest, enriched: data.enriched }), validate: (r) => draftSchema.parse(r) });
    return { event: 'DRAFTED', draft: { title: out.title, category: out.category, summary: out.summary, confidence: out.confidence ?? 0.6 } };
  } catch { return fallback; }
}

export async function opEnrichWebGrounded({ data, ai }: { data: SubjectBuildData; ai: Ai }): Promise<OperatorOutcome> {
  if (!ai.isConfigured()) return opEnrichBasic({ data, ai });
  try {
    const out = await ai.structured({ system: enrichWebGroundedSystem(), user: enrichWebGroundedUser({ rawRequest: data.rawRequest, referenceSet: data.referenceSet, evidence: data.evidence }), validate: (r) => draftSchema.parse(r) });
    return { event: 'DRAFTED', draft: { title: out.title, category: out.category, summary: out.summary, confidence: out.confidence ?? 0.7 } };
  } catch { return opEnrichBasic({ data, ai }); }
}

export async function opCategorySpecialize({ data, ai }: { data: SubjectBuildData; ai: Ai }): Promise<OperatorOutcome> {
  if (!ai.isConfigured()) return { event: 'SPECIALIZED' };
  try {
    const out = await ai.structured({ system: categorySpecializeSystem(), user: categorySpecializeUser({ draft: data.draft, rawRequest: data.rawRequest }), validate: (r) => specializeSchema.parse(r) });
    return { event: 'SPECIALIZED', draft: { attributes: out.attributes } };
  } catch { return { event: 'SPECIALIZED', note: 'category-specialize skipped (AI failed)' }; }
}

export async function opSelfCritique({ data, ai }: { data: SubjectBuildData; ai: Ai }): Promise<OperatorOutcome> {
  if (!ai.isConfigured()) return { event: 'REFINED' };
  try {
    const out = await ai.structured({ system: selfCritiqueSystem(), user: selfCritiqueUser({ draft: data.draft, rawRequest: data.rawRequest }), validate: (r) => critiqueSchema.parse(r) });
    return { event: 'REFINED', draft: { title: out.title, category: out.category, summary: out.summary, confidence: out.confidence ?? data.draft.confidence } };
  } catch { return { event: 'REFINED', note: 'self-critique skipped (AI failed)' }; }
}

export async function opDisambiguate({ data, ai }: { data: SubjectBuildData; ai: Ai }): Promise<OperatorOutcome> {
  if (!ai.isConfigured()) return { event: 'CLEAR' };
  try {
    const out = await ai.structured({ system: disambiguateSystem(), user: disambiguateUser({ rawRequest: data.rawRequest }), validate: (r) => disambiguateSchema.parse(r) });
    return { event: out.ambiguous ? 'AMBIGUOUS' : 'CLEAR', draft: { interpretation: out.interpretation } };
  } catch { return { event: 'CLEAR', note: 'disambiguate skipped (AI failed)' }; }
}

/** A near-identical prior subject found by reuse-lookup. */
export interface SubjectDraftReuse { snapshotId: string; summary?: string }

/** reuse-lookup: adapt a near-identical prior subject. `findReuse` wraps the (fixed) findReusableCandidates + decideReuse. */
export async function opReuseLookup({ data, findReuse }: { data: SubjectBuildData; findReuse: (draft: SubjectDraft) => Promise<SubjectDraftReuse | null> }): Promise<OperatorOutcome> {
  try {
    const hit = await findReuse(data.draft);
    if (!hit) return { event: 'NO_REUSE' };
    return { event: 'REUSED', draft: { reusedFrom: hit.snapshotId, ...(hit.summary ? { summary: hit.summary } : {}) }, note: `reused prior subject ${hit.snapshotId}` };
  } catch { return { event: 'NO_REUSE', note: 'reuse-lookup failed — continuing' }; }
}

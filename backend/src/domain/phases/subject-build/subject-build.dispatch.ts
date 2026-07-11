import { SubjectBuildData, draftToSubject, isInvariantMet } from './draft';
import { SUBJECT_IN, SUBJECT_OUT } from './operators';
import { MAX_OPERATORS } from './validate';
import {
  Ai, DomainStore, OperatorOutcome, SubjectDraftReuse, applyOutcome,
  opAttributeMine, opCategorySpecialize, opDisambiguate, opDomainLearn, opDomainRecall, opEnrichBasic, opEnrichWebGrounded, opIfElse, opJoin, opReuseLookup, opSelfCritique, opTargetIndustrySet, opTooling,
} from './operators.runtime';

/** Control events shared by every phase graph (must match the engine / seeded terminals). */
const STEP_FAILED = 'STEP_FAILED';

/** Injected side-effects the dispatcher needs (kept thin so the dispatch logic stays testable). */
export interface SubjectStepDeps {
  ai: Ai;
  findReuse: (draft: SubjectBuildData['draft']) => Promise<SubjectDraftReuse | null>;
  persist: (fields: { title: string; description: string; category: string }) => Promise<void>;
  /** The domain memory (read by domain-recall, written by domain-learn). Rehearsals inject a read-only sink. */
  domainStore: DomainStore;
}

export interface SubjectStepResult { event: string; data?: SubjectBuildData }

type Config = Record<string, unknown> | undefined;

/** operator id → its runtime function (bound to injected deps). */
function runOperator(operatorId: string, args: { data: SubjectBuildData; config: Config; deps: SubjectStepDeps }): Promise<OperatorOutcome> | OperatorOutcome | undefined {
  const { data, config, deps } = args;
  switch (operatorId) {
    case 'enrich-basic': return opEnrichBasic({ data, ai: deps.ai });
    case 'enrich-web-grounded': return opEnrichWebGrounded({ data, ai: deps.ai });
    case 'category-specialize': return opCategorySpecialize({ data, ai: deps.ai });
    case 'self-critique': return opSelfCritique({ data, ai: deps.ai });
    case 'disambiguate': return opDisambiguate({ data, ai: deps.ai });
    case 'reuse-lookup': return opReuseLookup({ data, findReuse: deps.findReuse });
    case 'target-industry-set': return opTargetIndustrySet({ data });
    case 'tooling': return opTooling({ config });
    case 'if-else': return opIfElse({ data, config });
    case 'join': return opJoin();
    case 'domain-recall': return opDomainRecall({ data, store: deps.domainStore });
    case 'domain-learn': return opDomainLearn({ data, store: deps.domainStore });
    case 'attribute-mine': return opAttributeMine({ data, ai: deps.ai });
    default: return undefined;
  }
}

/**
 * Execute one subject_build state: resolve its operator (handler ?? name), run it,
 * merge the outcome, and drive the boundary rules —
 *  - SUBJECT_IN emits READY (data is seeded at startRun),
 *  - SUBJECT_OUT enforces the persist invariant and writes the Subject (or STEP_FAILED),
 *  - the runtime ≤5 cap: a run that has already executed MAX_OPERATORS operators
 *    (only reachable via a loop; static paths are capped by the validator) fails
 *    cleanly rather than looping unbounded.
 * Returns the transition event + the new run data (the engine merges it as dataPatch).
 */
export async function runSubjectStep({ operatorId, config, data, deps }: {
  operatorId: string; config: Config; data: SubjectBuildData; deps: SubjectStepDeps;
}): Promise<SubjectStepResult> {
  if (operatorId === SUBJECT_IN) return { event: 'READY' };

  if (operatorId === SUBJECT_OUT) {
    if (!isInvariantMet(data.draft)) return { event: STEP_FAILED };
    await deps.persist(draftToSubject({ draft: data.draft, rawRequest: data.rawRequest }));
    return { event: 'SUBJECT_CREATED' };
  }

  if (data.stepCount >= MAX_OPERATORS) {
    return { event: STEP_FAILED, data: { ...data, notes: [...data.notes, `operator cap ${MAX_OPERATORS} reached`] } };
  }

  const outcome = await runOperator(operatorId, { data, config, deps });
  if (!outcome) return { event: STEP_FAILED, data: { ...data, notes: [...data.notes, `unknown operator ${operatorId}`] } };
  return { event: outcome.event, data: applyOutcome(data, outcome) };
}

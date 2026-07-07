import { SubjectBuildGraph, validateSubjectBuildGraph } from './validate';
import { RehearsalComparison } from './subject-rehearsal';
import { SubjectCase } from './subject-cases';

/**
 * The steps of one proposal, injected so the orchestration stays pure/testable:
 * - compose: the AI proposes a candidate composition given the current baseline (model).
 * - rehearse: score candidate-vs-baseline over the golden cases (model).
 * - saveDraft: persist the winning candidate as a DRAFT subject_build version — the
 *   operator reviews + publishes; we NEVER auto-publish.
 */
export interface ProposalDeps {
  compose: (baseline: SubjectBuildGraph) => Promise<SubjectBuildGraph>;
  rehearse: (args: { baseline: SubjectBuildGraph; candidate: SubjectBuildGraph; cases: SubjectCase[] }) => Promise<RehearsalComparison>;
  saveDraft: (args: { candidate: SubjectBuildGraph; comparison: RehearsalComparison }) => Promise<void>;
}

export type ProposalResult =
  | { outcome: 'proposed'; comparison: RehearsalComparison }   // drafted for operator review
  | { outcome: 'invalid'; errors: string[] }                   // failed the static validator — never rehearsed
  | { outcome: 'rejected'; comparison: RehearsalComparison };  // valid but didn't beat the baseline

/**
 * Run one subject_build proposal: compose a candidate, gate it statically (validator,
 * incl. the ≤5 cap), rehearse it against the baseline, and draft it only if it wins.
 * Cheap-then-expensive: an invalid candidate is dropped before any rehearsal spend,
 * and a valid-but-non-improving one is dropped before any operator is bothered.
 */
export async function runProposal({ baseline, cases, deps }: {
  baseline: SubjectBuildGraph; cases: SubjectCase[]; deps: ProposalDeps;
}): Promise<ProposalResult> {
  const candidate = await deps.compose(baseline);

  const validation = validateSubjectBuildGraph(candidate);
  if (!validation.valid) return { outcome: 'invalid', errors: validation.errors };

  const comparison = await deps.rehearse({ baseline, candidate, cases });
  if (!comparison.accept) return { outcome: 'rejected', comparison };

  await deps.saveDraft({ candidate, comparison }); // operator approves + publishes
  return { outcome: 'proposed', comparison };
}

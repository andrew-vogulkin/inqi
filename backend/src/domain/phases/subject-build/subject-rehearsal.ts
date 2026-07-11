import { initSubjectBuildData } from './draft';
import { interpretSubjectBuild } from './subject-build.interpreter';
import { SubjectStepDeps } from './subject-build.dispatch';
import { SubjectBuildGraph } from './validate';
import { SubjectCase } from './subject-cases';

/**
 * The deps a rehearsal needs — the model + reuse + (optionally) the domain
 * memory for realistic priors; persist is captured internally and domain WRITES
 * are always discarded (an experiment must never teach the live memory).
 */
export type RehearsalDeps = Pick<SubjectStepDeps, 'ai' | 'findReuse'> & { domainStore?: SubjectStepDeps['domainStore'] };

export interface SubjectCaseResult {
  caseId: string;
  passed: boolean;
  checks: { label: string; ok: boolean }[];
  built: { title: string; description: string; category: string } | null;
  steps: number;
}

export interface SubjectScorecard {
  passed: number;
  failed: number;
  total: number;
  cases: SubjectCaseResult[];
}

const includesAll = (text: string, needles?: string[]): boolean => (needles ?? []).every((n) => text.toLowerCase().includes(n.toLowerCase()));

/** Run one case through a candidate graph and grade the built Subject against its expectations. */
async function scoreCase({ graph, kase, deps }: { graph: SubjectBuildGraph; kase: SubjectCase; deps: RehearsalDeps }): Promise<SubjectCaseResult> {
  let built: SubjectCaseResult['built'] = null;
  const result = await interpretSubjectBuild({
    graph,
    data: initSubjectBuildData({ rawRequest: kase.request, enriched: kase.enriched }),
    deps: {
      ai: deps.ai,
      findReuse: deps.findReuse,
      persist: async (f) => { built = f; },
      // Real priors when provided, but writes ALWAYS land in the void — rehearsal stays pure.
      domainStore: { load: (args) => deps.domainStore?.load(args) ?? Promise.resolve(null), save: async () => undefined },
    },
  });
  const b = result.created ? built : null;

  const checks: { label: string; ok: boolean }[] = [];
  checks.push({ label: 'built a subject', ok: kase.expect.mustBuild ? !!b : !b });
  if (kase.expect.notNaive) checks.push({ label: 'not the naive title', ok: !!b && b.title !== kase.request.slice(0, 80) });
  if (kase.expect.category) checks.push({ label: `category=${kase.expect.category}`, ok: b?.category === kase.expect.category });
  if (kase.expect.titleIncludes) checks.push({ label: `title includes ${kase.expect.titleIncludes.join(',')}`, ok: !!b && includesAll(b.title, kase.expect.titleIncludes) });

  return { caseId: kase.id, passed: checks.every((c) => c.ok), checks, built: b, steps: result.data.stepCount };
}

/** Score a subject_build composition across the golden cases. */
export async function rehearseSubjectGraph({ graph, cases, deps }: { graph: SubjectBuildGraph; cases: SubjectCase[]; deps: RehearsalDeps }): Promise<SubjectScorecard> {
  const results: SubjectCaseResult[] = [];
  for (const kase of cases) results.push(await scoreCase({ graph, kase, deps }));
  return { passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, total: results.length, cases: results };
}

export interface RehearsalComparison {
  baseline: SubjectScorecard;
  candidate: SubjectScorecard;
  regressions: string[];   // case ids the candidate broke that the baseline passed
  gains: string[];         // case ids the candidate fixed that the baseline failed
  accept: boolean;         // a STRICT win: no regressions AND at least one gain
}

/**
 * Baseline-vs-candidate gate: a candidate composition is acceptable only if it
 * breaks NO case the baseline passed AND fixes at least one the baseline failed
 * (a strict win — a tie is rejected so operators only review genuine gains).
 * Both graphs run over the same cases + deps so the comparison is apples-to-apples.
 */
export async function compareSubjectGraphs({ baseline, candidate, cases, deps }: {
  baseline: SubjectBuildGraph; candidate: SubjectBuildGraph; cases: SubjectCase[]; deps: RehearsalDeps;
}): Promise<RehearsalComparison> {
  const b = await rehearseSubjectGraph({ graph: baseline, cases, deps });
  const c = await rehearseSubjectGraph({ graph: candidate, cases, deps });
  const bPass = new Set(b.cases.filter((r) => r.passed).map((r) => r.caseId));
  const cPass = new Set(c.cases.filter((r) => r.passed).map((r) => r.caseId));

  const regressions = [...bPass].filter((id) => !cPass.has(id));
  const gains = [...cPass].filter((id) => !bPass.has(id));
  return { baseline: b, candidate: c, regressions, gains, accept: regressions.length === 0 && gains.length > 0 };
}

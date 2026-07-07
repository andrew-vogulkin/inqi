import { ReportState } from '@inqi/shared';
import { CaseExpectations, RehearsalCase } from './rehearsal-case';

/**
 * The finished-run facts the scorer reads — derived from the delivered snapshot
 * (option provider names) + report state, plus optional cost metrics. Kept
 * decoupled from the DB/snapshot shape so the scorer stays pure and unit-testable.
 */
export interface RunOutcome {
  state: string;                 // terminal ReportState (REPORT_DELIVERED | FAILED | …)
  options: { name: string }[];   // delivered option provider names
  wallMs?: number;               // optional: run wall-clock
  tokens?: number;               // optional: model tokens spent
  costUsd?: number;              // optional: $ spent
}

export interface Check { label: string; ok: boolean; detail?: string }

export interface CaseResult {
  caseId: string;
  passed: boolean;               // every check ok
  checks: Check[];
  metrics: {
    optionCount: number;
    falseNegatives: number;      // required providers missing
    falsePositives: number;      // forbidden providers present
    wallMs?: number;
    tokens?: number;
    costUsd?: number;
  };
}

const norm = (s: string): string => s.toLowerCase().trim();
/** Case-insensitive substring match so "Hillcreek Gardens" matches "Hillcreek Gardens Tagaytay". */
const optionMatches = (options: { name: string }[], name: string): boolean =>
  options.some((o) => norm(o.name).includes(norm(name)));

/** Grade one finished run against its golden case. Deterministic, no model calls. */
export function evaluateCase({ rehearsalCase, outcome }: { rehearsalCase: RehearsalCase; outcome: RunOutcome }): CaseResult {
  const e: CaseExpectations = rehearsalCase.expectations;
  const checks: Check[] = [];
  const opts = outcome.options ?? [];

  const missing = (e.mustQualify ?? []).filter((n) => !optionMatches(opts, n));
  for (const n of e.mustQualify ?? []) {
    checks.push({ label: `qualifies: ${n}`, ok: optionMatches(opts, n), detail: optionMatches(opts, n) ? undefined : 'missing from options' });
  }
  const present = (e.mustDrop ?? []).filter((n) => optionMatches(opts, n));
  for (const n of e.mustDrop ?? []) {
    checks.push({ label: `drops: ${n}`, ok: !optionMatches(opts, n), detail: optionMatches(opts, n) ? 'unexpectedly present' : undefined });
  }
  if (e.mustFailGracefully) {
    const ok = outcome.state === ReportState.FAILED && opts.length === 0;
    checks.push({ label: 'fails gracefully (FAILED, no fabricated options)', ok, detail: ok ? undefined : `state=${outcome.state}, options=${opts.length}` });
  }
  if (e.mustDeny) {
    const ok = outcome.state === ReportState.DENIED && opts.length === 0;
    checks.push({ label: 'denied by compliance (DENIED, no options)', ok, detail: ok ? undefined : `state=${outcome.state}, options=${opts.length}` });
  }
  if (e.minOptions != null) {
    checks.push({ label: `≥ ${e.minOptions} options`, ok: opts.length >= e.minOptions, detail: `got ${opts.length}` });
  }
  if (e.maxOptions != null) {
    checks.push({ label: `≤ ${e.maxOptions} options`, ok: opts.length <= e.maxOptions, detail: `got ${opts.length}` });
  }

  return {
    caseId: rehearsalCase.id,
    passed: checks.every((c) => c.ok),
    checks,
    metrics: { optionCount: opts.length, falseNegatives: missing.length, falsePositives: present.length, wallMs: outcome.wallMs, tokens: outcome.tokens, costUsd: outcome.costUsd },
  };
}

export interface Scorecard {
  passed: number;
  failed: number;
  total: number;
  cases: CaseResult[];
  totals: { falseNegatives: number; falsePositives: number; wallMs: number; tokens: number; costUsd: number };
}

/** Roll per-case results into a run scorecard (the baseline-vs-candidate compare in S5 diffs two of these). */
export function scoreRun(results: CaseResult[]): Scorecard {
  const sum = (pick: (m: CaseResult['metrics']) => number | undefined) => results.reduce((a, r) => a + (pick(r.metrics) ?? 0), 0);
  return {
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    total: results.length,
    cases: results,
    totals: {
      falseNegatives: sum((m) => m.falseNegatives),
      falsePositives: sum((m) => m.falsePositives),
      wallMs: sum((m) => m.wallMs),
      tokens: sum((m) => m.tokens),
      costUsd: sum((m) => m.costUsd),
    },
  };
}

import { Field, IN_PROVIDES, OUT_REQUIRES, PALETTE, PREDICATES, SUBJECT_IN, SUBJECT_OUT } from './operators';

/** Max operator states on any IN→OUT path (excludes IN/OUT). Runtime enforces the same cap for loops. */
export const MAX_OPERATORS = 5;

export interface SubjectState {
  name: string;
  handler?: string;            // operator id; defaults to `name`
  config?: { predicate?: string } & Record<string, unknown>;
  isInitial?: boolean;
  isTerminal?: boolean;
}
export interface SubjectTransition { from: string; to: string; event: string }
export interface SubjectBuildGraph { states: SubjectState[]; transitions: SubjectTransition[] }

export interface ValidationResult { valid: boolean; errors: string[] }

const opOf = (s: SubjectState): string => s.handler ?? s.name;

/**
 * Statically validate a composed subject_build graph (docs/subject-build-slot.md
 * rules 1–5). Cheap rejection before anything runs: bounded slot, registered
 * operators, typed-I/O reachability, the persist invariant on every path, and the
 * ≤5-operator cap. Returns all violations (does not throw).
 */
export function validateSubjectBuildGraph(graph: SubjectBuildGraph): ValidationResult {
  const errors: string[] = [];
  const byName = new Map(graph.states.map((s) => [s.name, s]));

  // Rule 1 — bounded slot: exactly one initial (SUBJECT_IN) and a terminal SUBJECT_OUT.
  const initials = graph.states.filter((s) => s.isInitial);
  if (initials.length !== 1 || initials[0]?.name !== SUBJECT_IN) errors.push(`the only initial state must be ${SUBJECT_IN}`);
  const out = byName.get(SUBJECT_OUT);
  if (!out || !out.isTerminal) errors.push(`${SUBJECT_OUT} must exist and be terminal`);

  // Rule 4 (registered operators) — every state resolves to a palette operator; every
  // outgoing transition's event is one that operator can emit; if-else needs a known predicate.
  for (const s of graph.states) {
    const spec = PALETTE[opOf(s)];
    if (!spec) { errors.push(`state "${s.name}" is not a registered operator`); continue; }
    const outgoing = graph.transitions.filter((t) => t.from === s.name);
    for (const t of outgoing) {
      if (!spec.emits.includes(t.event)) errors.push(`operator "${opOf(s)}" cannot emit "${t.event}" (state ${s.name})`);
      if (!byName.has(t.to)) errors.push(`transition ${s.name} → ${t.to} targets an unknown state`);
    }
    if (opOf(s) === 'if-else' && !PREDICATES.includes(s.config?.predicate as never)) {
      errors.push(`if-else state "${s.name}" needs a registered predicate (got ${JSON.stringify(s.config?.predicate)})`);
    }
  }

  // Rules 2, 3, 5 are path properties — enumerate simple IN→OUT paths and check each.
  const paths = simplePaths(graph, SUBJECT_IN, SUBJECT_OUT);
  if (!paths.length && byName.has(SUBJECT_IN) && byName.has(SUBJECT_OUT)) errors.push(`${SUBJECT_OUT} is unreachable from ${SUBJECT_IN}`);

  for (const path of paths) {
    const ops = path.slice(1, -1); // operator states between IN and OUT
    if (ops.length > MAX_OPERATORS) errors.push(`path ${path.join(' → ')} runs ${ops.length} operators (> ${MAX_OPERATORS})`);

    // Rules 2 & 3: typed-I/O reachability — each operator's reads must be produced upstream.
    const available = new Set<string>(IN_PROVIDES);
    for (const name of path) {
      const st = byName.get(name);
      if (!st) break; // transition targeted an unknown state (already reported at rule 4) — reject, don't deref
      const spec = PALETTE[opOf(st)];
      if (!spec) break; // already reported
      const missing = spec.reads.filter((r) => !available.has(r));
      if (missing.length) errors.push(`operator "${opOf(st)}" reads ${missing.join(', ')} not produced upstream (path ${path.join(' → ')})`);
      spec.writes.forEach((w) => available.add(w));
    }
    // Rule invariant: SUBJECT_OUT's required fields written somewhere on the path.
    const unmet = OUT_REQUIRES.filter((f) => !available.has(f));
    if (unmet.length) errors.push(`path ${path.join(' → ')} never writes ${unmet.join(', ')} (needed to persist the Subject)`);
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

/** All simple (acyclic) paths from `start` to `end`. Bounded graphs → fine to enumerate. */
function simplePaths(graph: SubjectBuildGraph, start: string, end: string): string[][] {
  const edges = new Map<string, string[]>();
  for (const t of graph.transitions) edges.set(t.from, [...(edges.get(t.from) ?? []), t.to]);
  const out: string[][] = [];
  const walk = (node: string, seen: Set<string>, path: string[]): void => {
    if (node === end) { out.push(path); return; }
    for (const next of edges.get(node) ?? []) {
      if (seen.has(next)) continue; // no cycles in a simple path
      walk(next, new Set([...seen, next]), [...path, next]);
    }
  };
  if (graph.states.some((s) => s.name === start)) walk(start, new Set([start]), [start]);
  return out;
}

/** Re-exported so callers can build/inspect the same field vocabulary. */
export { Field, PALETTE };

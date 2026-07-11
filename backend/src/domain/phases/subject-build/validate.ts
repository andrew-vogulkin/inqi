import { Field, IN_PROVIDES, OUT_REQUIRES, PALETTE, PREDICATES, SUBJECT_IN, SUBJECT_OUT } from './operators';

/**
 * The operator budget: no more than this many operators run between IN and OUT
 * (raised 5 → 10 with the layered-network upgrade). Enforced statically here and
 * at runtime via `data.stepCount` (the dispatcher refuses the 11th execution).
 */
export const MAX_OPERATORS = 10;
/** Max depth of a layered network (operator layers between IN and OUT). */
export const MAX_LAYERS = 10;

export interface SubjectState {
  name: string;
  handler?: string;            // operator id; defaults to `name`
  layer?: number;              // network layer 1..MAX_LAYERS (also read from config.layer)
  config?: { predicate?: string; layer?: number } & Record<string, unknown>;
  isInitial?: boolean;
  isTerminal?: boolean;
}
export interface SubjectTransition { from: string; to: string; event: string }
export interface SubjectBuildGraph { states: SubjectState[]; transitions: SubjectTransition[] }

export interface ValidationResult { valid: boolean; errors: string[] }

const opOf = (s: SubjectState): string => s.handler ?? s.name;
/** A state's authored layer, wherever it was written (top-level or config). */
export const layerOf = (s: SubjectState): number | undefined =>
  typeof s.layer === 'number' ? s.layer : typeof s.config?.layer === 'number' ? (s.config.layer as number) : undefined;

/**
 * Statically validate a composed subject_build graph (docs/subject-build-slot.md
 * rules 1–5, extended by docs/subject-build-network.md). Cheap rejection before
 * anything runs. Two modes, both bounded by the 10-operator budget:
 *  - ACYCLIC graphs are layered NETWORKS (M:M edges, forward-pass execution):
 *    edges must strictly deepen, ≤ MAX_LAYERS layers, ≤ MAX_OPERATORS reachable
 *    operators, reads satisfiable from IN + ancestor writes.
 *  - CYCLIC graphs keep the legacy single-walk rules (per-path checks); the
 *    runtime step budget bounds their loops.
 * Returns all violations (does not throw).
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
  if (errors.length) return { valid: false, errors: [...new Set(errors)] }; // structure is broken — deeper checks would deref junk

  if (hasCycle(graph)) validateLegacyPaths(graph, errors);
  else validateLayeredNetwork(graph, errors);

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

/** Layered-network rules (acyclic M:M graphs — the forward-pass engine runs these). */
function validateLayeredNetwork(graph: SubjectBuildGraph, errors: string[]): void {
  const byName = new Map(graph.states.map((s) => [s.name, s]));
  const derived = deriveLayers(graph);
  if (!derived.has(SUBJECT_OUT)) errors.push(`${SUBJECT_OUT} is unreachable from ${SUBJECT_IN}`);

  const reachableOps = graph.states.filter((s) => derived.has(s.name) && s.name !== SUBJECT_IN && s.name !== SUBJECT_OUT);
  if (reachableOps.length > MAX_OPERATORS) {
    errors.push(`${reachableOps.length} operators reachable from ${SUBJECT_IN} (> ${MAX_OPERATORS} — the whole pass must fit the operator budget)`);
  }

  // Layers: authored ones must be in range; every edge must strictly deepen
  // (effective layer = authored ?? derived; IN is 0, OUT is beyond the last layer).
  const effective = (name: string): number => {
    if (name === SUBJECT_IN) return 0;
    if (name === SUBJECT_OUT) return MAX_LAYERS + 1;
    const s = byName.get(name);
    return (s && layerOf(s)) ?? derived.get(name) ?? 0;
  };
  for (const s of reachableOps) {
    const authored = layerOf(s);
    if (authored !== undefined && (authored < 1 || authored > MAX_LAYERS)) errors.push(`state "${s.name}" has layer ${authored} (must be 1..${MAX_LAYERS})`);
    if ((derived.get(s.name) ?? 0) > MAX_LAYERS) errors.push(`state "${s.name}" sits deeper than ${MAX_LAYERS} layers`);
  }
  for (const t of graph.transitions) {
    if (!derived.has(t.from)) continue; // unreachable region — harmless
    if (effective(t.from) >= effective(t.to)) errors.push(`edge ${t.from} → ${t.to} does not deepen (layer ${effective(t.from)} → ${effective(t.to)}) — edges must go to a strictly deeper layer`);
  }

  // Typed I/O over the blackboard: a node's reads must be satisfiable from
  // SUBJECT_IN plus the writes of its ANCESTORS (fan-in merges all of them).
  const ancestors = ancestorMap(graph);
  const availableFor = (name: string): Set<string> => {
    const avail = new Set<string>(IN_PROVIDES);
    for (const a of ancestors.get(name) ?? []) {
      const spec = PALETTE[opOf(byName.get(a)!)];
      spec?.writes.forEach((w) => avail.add(w));
    }
    return avail;
  };
  for (const s of reachableOps) {
    const spec = PALETTE[opOf(s)];
    const missing = spec.reads.filter((r) => !availableFor(s.name).has(r));
    if (missing.length) errors.push(`operator "${opOf(s)}" reads ${missing.join(', ')} not written by any ancestor (state ${s.name})`);
  }
  if (derived.has(SUBJECT_OUT)) {
    const unmet = OUT_REQUIRES.filter((f) => !availableFor(SUBJECT_OUT).has(f));
    if (unmet.length) errors.push(`no ancestor of ${SUBJECT_OUT} writes ${unmet.join(', ')} (needed to persist the Subject)`);
  }
}

/** Legacy single-walk rules (cyclic graphs): per-path typed I/O + the persist invariant. */
function validateLegacyPaths(graph: SubjectBuildGraph, errors: string[]): void {
  const byName = new Map(graph.states.map((s) => [s.name, s]));
  const paths = simplePaths(graph, SUBJECT_IN, SUBJECT_OUT);
  if (!paths.length && byName.has(SUBJECT_IN) && byName.has(SUBJECT_OUT)) errors.push(`${SUBJECT_OUT} is unreachable from ${SUBJECT_IN}`);

  for (const path of paths) {
    const ops = path.slice(1, -1); // operator states between IN and OUT
    if (ops.length > MAX_OPERATORS) errors.push(`path ${path.join(' → ')} runs ${ops.length} operators (> ${MAX_OPERATORS})`);

    const available = new Set<string>(IN_PROVIDES);
    for (const name of path) {
      const st = byName.get(name);
      if (!st) break;
      const spec = PALETTE[opOf(st)];
      if (!spec) break;
      const missing = spec.reads.filter((r) => !available.has(r));
      if (missing.length) errors.push(`operator "${opOf(st)}" reads ${missing.join(', ')} not produced upstream (path ${path.join(' → ')})`);
      spec.writes.forEach((w) => available.add(w));
    }
    const unmet = OUT_REQUIRES.filter((f) => !available.has(f));
    if (unmet.length) errors.push(`path ${path.join(' → ')} never writes ${unmet.join(', ')} (needed to persist the Subject)`);
  }
}

// --- graph helpers (shared with the interpreter) ----------------------------

function edgeMap(graph: SubjectBuildGraph): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  for (const t of graph.transitions) edges.set(t.from, [...(edges.get(t.from) ?? []), t.to]);
  return edges;
}

/** True when the transition graph contains a cycle (→ legacy walk semantics). */
export function hasCycle(graph: SubjectBuildGraph): boolean {
  const edges = edgeMap(graph);
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 'done') return false;
    if (state.get(n) === 'visiting') return true;
    state.set(n, 'visiting');
    for (const next of edges.get(n) ?? []) if (visit(next)) return true;
    state.set(n, 'done');
    return false;
  };
  return graph.states.some((s) => visit(s.name));
}

/**
 * Derived layer per REACHABLE node = longest edge-distance from SUBJECT_IN
 * (IN = 0). Acyclic graphs only; this is the forward-pass execution order.
 */
export function deriveLayers(graph: SubjectBuildGraph): Map<string, number> {
  const edges = edgeMap(graph);
  const layers = new Map<string, number>();
  const walk = (n: string, depth: number): void => {
    if ((layers.get(n) ?? -1) >= depth) return;
    layers.set(n, depth);
    for (const next of edges.get(n) ?? []) walk(next, depth + 1);
  };
  if (graph.states.some((s) => s.name === SUBJECT_IN)) walk(SUBJECT_IN, 0);
  return layers;
}

/** name → the set of nodes with an edge-path INTO it (its blackboard feeders). */
function ancestorMap(graph: SubjectBuildGraph): Map<string, Set<string>> {
  const into = new Map<string, string[]>();
  for (const t of graph.transitions) into.set(t.to, [...(into.get(t.to) ?? []), t.from]);
  const memo = new Map<string, Set<string>>();
  const collect = (n: string, seen: Set<string>): Set<string> => {
    if (memo.has(n)) return memo.get(n)!;
    const acc = new Set<string>();
    for (const p of into.get(n) ?? []) {
      if (seen.has(p) || p === SUBJECT_IN) continue;
      acc.add(p);
      collect(p, new Set([...seen, p])).forEach((x) => acc.add(x));
    }
    memo.set(n, acc);
    return acc;
  };
  for (const s of graph.states) collect(s.name, new Set([s.name]));
  return memo;
}

/** All simple (acyclic) paths from `start` to `end`. Bounded graphs → fine to enumerate. */
function simplePaths(graph: SubjectBuildGraph, start: string, end: string): string[][] {
  const edges = edgeMap(graph);
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

import { SubjectBuildData } from './draft';
import { SUBJECT_IN, SUBJECT_OUT } from './operators';
import { runSubjectStep, SubjectStepDeps } from './subject-build.dispatch';
import { MAX_OPERATORS, SubjectBuildGraph, SubjectState, deriveLayers, hasCycle, layerOf } from './validate';

const STEP_FAILED = 'STEP_FAILED';
/** Absolute walk guard for the LEGACY (cyclic) walk — the runtime operator budget is the real bound. */
const MAX_WALK = 32;

export interface InterpretResult {
  created: boolean;         // a Subject was persisted at SUBJECT_OUT
  data: SubjectBuildData;   // final run scratchpad
  path: string[];           // states executed, in order (for logging/debug)
}

/**
 * Execute a subject_build composition (docs/subject-build-network.md):
 *  - ACYCLIC graphs run as a layered NETWORK — a layer-synchronous forward pass
 *    where one emitted event fires ALL matching out-edges (fan-out) and a node
 *    with several fired in-edges runs ONCE over the merged blackboard (fan-in).
 *  - CYCLIC graphs keep the legacy single-path walk (one transition per step).
 * Either way the run is bounded by the operator budget; if SUBJECT_OUT never
 * persists, the caller falls back to the naive subject so the report proceeds.
 */
export async function interpretSubjectBuild({ graph, data, deps }: {
  graph: SubjectBuildGraph; data: SubjectBuildData; deps: SubjectStepDeps;
}): Promise<InterpretResult> {
  return hasCycle(graph) ? walkLegacy({ graph, data, deps }) : forwardPass({ graph, data, deps });
}

/** The layered forward pass (acyclic M:M networks — including all linear graphs). */
async function forwardPass({ graph, data, deps }: { graph: SubjectBuildGraph; data: SubjectBuildData; deps: SubjectStepDeps }): Promise<InterpretResult> {
  const derived = deriveLayers(graph);
  // Execution order: authored layer (else derived), then declaration order — deterministic merges.
  const order = graph.states
    .filter((s) => derived.has(s.name) && s.name !== SUBJECT_IN && s.name !== SUBJECT_OUT)
    .map((s, i) => ({ s, layer: layerOf(s) ?? derived.get(s.name)!, i }))
    .sort((a, b) => a.layer - b.layer || a.i - b.i);

  let d = data;
  const path: string[] = [];
  const emitted = new Map<string, string>(); // activated node → its event

  // A node activates iff at least one in-edge fired: its source activated AND emitted that edge's event.
  const fired = (name: string): boolean =>
    graph.transitions.some((t) => t.to === name && emitted.get(t.from) === t.event);

  const inState = graph.states.find((s) => s.isInitial);
  if (!inState) return { created: false, data: d, path };
  path.push(inState.name);
  const inRes = await runSubjectStep({ operatorId: inState.handler ?? inState.name, config: inState.config, data: d, deps });
  emitted.set(inState.name, inRes.event);

  for (const { s } of order) {
    if (d.stepCount >= MAX_OPERATORS) { d = { ...d, notes: [...d.notes, `operator budget ${MAX_OPERATORS} exhausted — remaining layers skipped`] }; break; }
    if (!fired(s.name)) continue;
    const res = await runSubjectStep({ operatorId: s.handler ?? s.name, config: s.config, data: d, deps });
    if (res.data) d = res.data;
    path.push(s.name);
    if (res.event === STEP_FAILED) continue; // a dead branch never kills the pass — it just doesn't fire its edges
    emitted.set(s.name, res.event);
  }

  const outState = graph.states.find((s) => s.name === SUBJECT_OUT);
  if (!outState || !fired(SUBJECT_OUT)) return { created: false, data: d, path };
  path.push(SUBJECT_OUT);
  const outRes = await runSubjectStep({ operatorId: SUBJECT_OUT, config: outState.config, data: d, deps });
  if (outRes.data) d = outRes.data;
  return { created: outRes.event === 'SUBJECT_CREATED', data: d, path };
}

/** The legacy walk (cyclic graphs): one state at a time, first matching transition. */
async function walkLegacy({ graph, data, deps }: { graph: SubjectBuildGraph; data: SubjectBuildData; deps: SubjectStepDeps }): Promise<InterpretResult> {
  let state: SubjectState | null = graph.states.find((s) => s.isInitial) ?? null;
  let d = data;
  const path: string[] = [];

  for (let i = 0; state && i < MAX_WALK; i++) {
    path.push(state.name);
    const operatorId = state.handler ?? state.name;
    const res = await runSubjectStep({ operatorId, config: state.config, data: d, deps });
    if (res.data) d = res.data;

    if (operatorId === SUBJECT_OUT) return { created: res.event === 'SUBJECT_CREATED', data: d, path };
    if (res.event === STEP_FAILED) return { created: false, data: d, path };

    const t = graph.transitions.find((tr) => tr.from === state!.name && tr.event === res.event);
    if (!t) return { created: false, data: d, path };        // no wired transition for this event → dead end
    state = graph.states.find((s) => s.name === t.to) ?? null;
  }
  return { created: false, data: d, path };
}

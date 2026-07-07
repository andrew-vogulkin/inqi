import { SubjectBuildData } from './draft';
import { SUBJECT_OUT } from './operators';
import { runSubjectStep, SubjectStepDeps } from './subject-build.dispatch';
import { SubjectBuildGraph } from './validate';

const STEP_FAILED = 'STEP_FAILED';
/** Absolute walk guard — the ≤5 operator cap in the dispatcher is the real bound; this only stops a malformed cyclic graph. */
const MAX_WALK = 32;

export interface InterpretResult {
  created: boolean;         // a Subject was persisted at SUBJECT_OUT
  data: SubjectBuildData;   // final run scratchpad
  path: string[];           // states visited (for logging/debug)
}

/**
 * Walk a subject_build graph synchronously: from the initial state, run each state's
 * operator (handler ?? name), follow the (fromState, event) transition, until
 * SUBJECT_OUT persists (created) or a dead-end / STEP_FAILED / cap stops it (not
 * created → the caller falls back to a naive subject so the report still proceeds).
 * Bounded execution: the dispatcher fails after MAX_OPERATORS, so the whole walk is
 * at most a handful of model calls — cheap enough to run inline in the SUBJECT step.
 */
export async function interpretSubjectBuild({ graph, data, deps }: {
  graph: SubjectBuildGraph; data: SubjectBuildData; deps: SubjectStepDeps;
}): Promise<InterpretResult> {
  let state = graph.states.find((s) => s.isInitial) ?? null;
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

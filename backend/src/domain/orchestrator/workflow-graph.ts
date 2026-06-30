import { WorkflowStatus } from '@inqi/shared';
import { ConflictError, ErrorCode } from '../../common/errors';

/** Minimal shapes for graph reasoning (mirror WorkflowState / WorkflowTransition). */
export interface GraphState { name: string; isInitial: boolean; isTerminal: boolean }
export interface GraphTransition { fromState: string; toState: string; event: string }
export interface WorkflowGraph { states: GraphState[]; transitions: GraphTransition[] }

export interface GraphValidation { valid: boolean; errors: string[] }

/**
 * Pure pre-activation validation (HP-12): a publishable workflow must have exactly
 * one initial state, at least one terminal, no dangling transitions (every
 * from/to references a real state), and every terminal reachable from the initial
 * state. Returns all problems at once so the operator sees the full picture.
 */
export function validateWorkflowGraph({ states, transitions }: WorkflowGraph): GraphValidation {
  const errors: string[] = [];
  const names = new Set(states.map((s) => s.name));

  const initials = states.filter((s) => s.isInitial);
  if (initials.length !== 1) errors.push(`expected exactly 1 initial state, found ${initials.length}`);

  const terminals = states.filter((s) => s.isTerminal);
  if (terminals.length === 0) errors.push('no terminal state defined');

  for (const t of transitions) {
    if (!names.has(t.fromState)) errors.push(`transition from unknown state "${t.fromState}" (on ${t.event})`);
    if (!names.has(t.toState)) errors.push(`transition to unknown state "${t.toState}" (on ${t.event})`);
  }

  // Reachability from the single initial state (only meaningful when the above hold).
  if (initials.length === 1 && errors.length === 0) {
    const adj = new Map<string, string[]>();
    for (const t of transitions) (adj.get(t.fromState) ?? adj.set(t.fromState, []).get(t.fromState)!).push(t.toState);
    const seen = new Set<string>([initials[0].name]);
    const queue = [initials[0].name];
    while (queue.length) {
      for (const next of adj.get(queue.shift()!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    for (const term of terminals) if (!seen.has(term.name)) errors.push(`terminal state "${term.name}" is unreachable from "${initials[0].name}"`);
  }

  return { valid: errors.length === 0, errors };
}

/** Guard: only `draft` versions may be edited; active/archived are immutable. Throws a typed 409. */
export function assertVersionEditable(status: string): void {
  if (status !== WorkflowStatus.Draft) {
    throw new ConflictError({
      code: ErrorCode.InvalidWorkflowTransition,
      message: `workflow version is ${status} and immutable; only draft versions are editable`,
      details: { status },
    });
  }
}

export interface VersionDiff {
  states: { added: string[]; removed: string[] };
  transitions: { added: string[]; removed: string[] };
}

const tkey = (t: GraphTransition) => `${t.fromState} --${t.event}--> ${t.toState}`;

/** Pure diff of two versions (b relative to a): what states/transitions were added/removed. */
export function diffVersions({ a, b }: { a: WorkflowGraph; b: WorkflowGraph }): VersionDiff {
  const aStates = new Set(a.states.map((s) => s.name));
  const bStates = new Set(b.states.map((s) => s.name));
  const aTrans = new Set(a.transitions.map(tkey));
  const bTrans = new Set(b.transitions.map(tkey));
  const diff = (from: Set<string>, to: Set<string>) => [...to].filter((x) => !from.has(x));
  return {
    states: { added: diff(aStates, bStates), removed: diff(bStates, aStates) },
    transitions: { added: diff(aTrans, bTrans), removed: diff(bTrans, aTrans) },
  };
}

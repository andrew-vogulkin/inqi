import { WorkflowStatus } from '@inqi/shared';
import { assertVersionEditable, diffVersions, validateWorkflowGraph, WorkflowGraph } from './workflow-graph';

const good: WorkflowGraph = {
  states: [
    { name: 'A', isInitial: true, isTerminal: false },
    { name: 'B', isInitial: false, isTerminal: false },
    { name: 'DONE', isInitial: false, isTerminal: true },
  ],
  transitions: [
    { fromState: 'A', toState: 'B', event: 'go' },
    { fromState: 'B', toState: 'DONE', event: 'finish' },
  ],
};

describe('validateWorkflowGraph', () => {
  it('accepts a well-formed graph', () => {
    expect(validateWorkflowGraph(good)).toEqual({ valid: true, errors: [] });
  });
  it('rejects zero or multiple initial states', () => {
    expect(validateWorkflowGraph({ ...good, states: good.states.map((s) => ({ ...s, isInitial: false })) }).valid).toBe(false);
    expect(validateWorkflowGraph({ ...good, states: good.states.map((s) => ({ ...s, isInitial: true })) }).valid).toBe(false);
  });
  it('rejects no terminal state', () => {
    const g = { ...good, states: good.states.map((s) => ({ ...s, isTerminal: false })) };
    expect(validateWorkflowGraph(g).errors).toContain('no terminal state defined');
  });
  it('rejects a dangling transition (unknown target)', () => {
    const g: WorkflowGraph = { ...good, transitions: [...good.transitions, { fromState: 'B', toState: 'NOPE', event: 'x' }] };
    expect(validateWorkflowGraph(g).valid).toBe(false);
  });
  it('rejects an unreachable terminal', () => {
    const g: WorkflowGraph = {
      states: [...good.states, { name: 'ISLAND', isInitial: false, isTerminal: true }],
      transitions: good.transitions,
    };
    expect(validateWorkflowGraph(g).errors.some((e) => /ISLAND.*unreachable/.test(e))).toBe(true);
  });
});

describe('assertVersionEditable', () => {
  it('allows editing a draft', () => expect(() => assertVersionEditable(WorkflowStatus.Draft)).not.toThrow());
  it('rejects editing active/archived', () => {
    expect(() => assertVersionEditable(WorkflowStatus.Active)).toThrow(/immutable/i);
    expect(() => assertVersionEditable(WorkflowStatus.Archived)).toThrow(/immutable/i);
  });
});

describe('diffVersions', () => {
  it('detects added/removed states + transitions', () => {
    const next: WorkflowGraph = {
      states: [...good.states, { name: 'C', isInitial: false, isTerminal: false }],
      transitions: [good.transitions[0], { fromState: 'A', toState: 'C', event: 'branch' }],
    };
    const d = diffVersions(good, next);
    expect(d.states.added).toEqual(['C']);
    expect(d.transitions.added).toContain('A --branch--> C');
    expect(d.transitions.removed).toContain('B --finish--> DONE');
  });
});

import { BreadthEvent, BreadthPurpose, BreadthState, DepthEvent, DepthState, PhaseControlEvent, PhaseKey, PreResearchState, WorkflowEvent, parentFailureEventForPhase } from '@inqi/shared';
import { validateWorkflowGraph } from '../orchestrator/workflow-graph';
import { BREADTH_SEARCH_GRAPH, DEPTH_SEARCH_GRAPH, PHASE_GRAPHS, PRE_RESEARCH_GRAPH, PhaseAction, PhaseGraph, PhaseGuard } from './phase-graphs';

/** The graph rows in the shape validateWorkflowGraph expects. */
function toGraph(g: PhaseGraph) {
  return {
    states: g.states.map((s) => ({ name: s.name, isInitial: !!s.isInitial, isTerminal: !!s.isTerminal })),
    transitions: g.transitions.map((t) => ({ fromState: t.from, toState: t.to, event: t.event })),
  };
}

describe('phase graphs — the seeded pre_research / breadth_search / depth_search machines', () => {
  it.each(PHASE_GRAPHS.map((g) => [g.key, g] as const))('%s passes graph validation (1 initial, terminals reachable, no dangling)', (_key, graph) => {
    const validation = validateWorkflowGraph(toGraph(graph));
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it.each(PHASE_GRAPHS.map((g) => [g.key, g] as const))('%s: every working state carries STEP_FAILED and CANCEL rows', (_key, graph) => {
    const working = graph.states.filter((s) => !s.isTerminal).map((s) => s.name);
    for (const state of working) {
      const events = graph.transitions.filter((t) => t.from === state).map((t) => t.event);
      expect(events).toContain(PhaseControlEvent.STEP_FAILED);
      expect(events).toContain(PhaseControlEvent.CANCEL);
    }
  });

  it('every referenced action/guard string is a registry constant (seed ↔ registry sync)', () => {
    const actions = new Set<string>(Object.values(PhaseAction));
    const guards = new Set<string>(Object.values(PhaseGuard));
    for (const graph of PHASE_GRAPHS) {
      for (const t of graph.transitions) {
        if (t.action) expect(actions).toContain(t.action);
        if (t.guard) expect(guards).toContain(t.guard);
      }
    }
  });

  it('pre_research: terminals bridge to the parent report events', () => {
    const find = (from: string, event: string) => PRE_RESEARCH_GRAPH.transitions.find((t) => t.from === from && t.event === event);
    expect(find(PreResearchState.QUESTIONNAIRE_GATE, 'QUESTIONNAIRE_OK')?.action).toBe(PhaseAction.ReportPreResearchPassed);
    expect(find(PreResearchState.COMPLIANCE_GATE, 'GATE_BLOCKED')?.action).toBe(PhaseAction.ReportPreResearchDenied);
    expect(find(PreResearchState.COMPLIANCE_GATE, PhaseControlEvent.STEP_FAILED)?.action).toBe(PhaseAction.ReportPreResearchFailed);
  });

  it('breadth_search: RELAX loops back to SEARCH (relax already produced the new queries)', () => {
    const relaxed = BREADTH_SEARCH_GRAPH.transitions.find((t) => t.from === BreadthState.RELAX && t.event === BreadthEvent.RELAXED);
    expect(relaxed?.to).toBe(BreadthState.SEARCH);
    const cont = BREADTH_SEARCH_GRAPH.transitions.find((t) => t.from === BreadthState.CHECKPOINT && t.event === BreadthEvent.CONTINUE);
    expect(cont?.guard).toBe(PhaseGuard.BreadthUnderCycleCap);
    // Every result terminal hands the candidates to funnel assembly.
    for (const event of [BreadthEvent.TARGET_MET, BreadthEvent.WENT_DRY, BreadthEvent.CAP_REACHED]) {
      expect(BREADTH_SEARCH_GRAPH.transitions.find((t) => t.from === BreadthState.CHECKPOINT && t.event === event)?.action).toBe(PhaseAction.BreadthComplete);
    }
  });

  it('depth_search: refine loops GATE → INVESTIGATE; PERSIST maps outcomes to matching terminals', () => {
    const refine = DEPTH_SEARCH_GRAPH.transitions.find((t) => t.from === DepthState.GATE && t.event === DepthEvent.GAPS_NAMED);
    expect(refine?.to).toBe(DepthState.INVESTIGATE);
    expect(refine?.guard).toBe(PhaseGuard.DepthUnderCycleCap);
    expect(DEPTH_SEARCH_GRAPH.transitions.find((t) => t.from === DepthState.PERSIST && t.event === DepthEvent.PERSISTED_SUFFICIENT)?.to).toBe(DepthState.SUFFICIENT);
    // Fail AND cancel both clear researchPending — a dead run must never stall synthesis.
    const cancel = DEPTH_SEARCH_GRAPH.transitions.find((t) => t.from === DepthState.INVESTIGATE && t.event === PhaseControlEvent.CANCEL);
    expect(cancel?.action).toBe(PhaseAction.InquiryResearchFailed);
  });
});

describe('parentFailureEventForPhase — how a dead run maps onto the report machine', () => {
  it('pre_research always fails the report stage', () => {
    expect(parentFailureEventForPhase({ key: PhaseKey.PreResearch })).toBe(WorkflowEvent.PRE_RESEARCH_FAILED);
  });
  it('breadth fails the report only for the funnel purpose; a widen failure degrades', () => {
    expect(parentFailureEventForPhase({ key: PhaseKey.BreadthSearch, purpose: BreadthPurpose.Funnel })).toBe(WorkflowEvent.FUNNEL_FAILED);
    expect(parentFailureEventForPhase({ key: PhaseKey.BreadthSearch, purpose: BreadthPurpose.Widen })).toBeNull();
  });
  it('depth fails the inquiry, never the report', () => {
    expect(parentFailureEventForPhase({ key: PhaseKey.DepthSearch })).toBeNull();
  });
});

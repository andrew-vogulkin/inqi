import { GraphStateDto, GraphTransitionDto } from '../api/types';

/** A positioned state pill in the diagram (px, left-to-right layers). */
export interface DiagramNode { name: string; isInitial: boolean; isTerminal: boolean; layer: number; x: number; y: number; w: number; h: number }
/** A drawn transition; `back` = it returns to an earlier/equal layer (e.g. ON_HOLD → OUTREACH). */
export interface DiagramEdge { from: string; to: string; event: string; back: boolean }
/** A same-event fan-in collapsed out of the drawing (e.g. CANCEL from 9 states) — rendered as a note. */
export interface CollapsedEdge { event: string; toState: string; fromCount: number }

export interface WorkflowDiagram { nodes: DiagramNode[]; edges: DiagramEdge[]; collapsed: CollapsedEdge[]; width: number; height: number }

export const NODE_H = 26;
const MARGIN = 16;
const ROW_GAP = 22;
const LAYER_GAP = 76;
const CHAR_W = 6.6; // approx Geist Mono at 10.5px — layout only needs a stable estimate

/** Same-event edges converging on one state from this many sources collapse into a note. */
export const COLLAPSE_FAN_IN = 4;

const nodeWidth = (name: string) => Math.max(88, Math.round(16 + name.length * CHAR_W));

/**
 * Split off high-fan-in same-event edge groups (the CANCEL-from-everywhere case):
 * drawing 9 near-parallel arrows into one sink buries the real flow, so groups of
 * {@link COLLAPSE_FAN_IN}+ become a single legend note instead.
 */
export function splitCommonEdges(transitions: GraphTransitionDto[]): { drawn: GraphTransitionDto[]; collapsed: CollapsedEdge[] } {
  const byGroup = new Map<string, GraphTransitionDto[]>();
  for (const t of transitions) {
    const key = `${t.event}→${t.toState}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), t]);
  }
  const drawn: GraphTransitionDto[] = [];
  const collapsed: CollapsedEdge[] = [];
  for (const group of byGroup.values()) {
    if (group.length >= COLLAPSE_FAN_IN) collapsed.push({ event: group[0].event, toState: group[0].toState, fromCount: group.length });
    else drawn.push(...group);
  }
  // Keep the original transition order for the drawn set (grouping shuffled it).
  const drawnSet = new Set(drawn);
  return { drawn: transitions.filter((t) => drawnSet.has(t)), collapsed };
}

/**
 * Longest-path layering from the initial state(s), cycle-safe: an edge landing on
 * a node already on the DFS stack is a back edge — it is drawn (dashed) but does
 * not participate in layering, so ON_HOLD → OUTREACH cannot inflate depths.
 */
export function computeLayers({ states, transitions }: { states: GraphStateDto[]; transitions: GraphTransitionDto[] }): { layers: Map<string, number>; backEdges: Set<GraphTransitionDto> } {
  const known = new Set(states.map((s) => s.name));
  const out = new Map<string, GraphTransitionDto[]>();
  for (const t of transitions) {
    if (!known.has(t.fromState) || !known.has(t.toState)) continue;
    out.set(t.fromState, [...(out.get(t.fromState) ?? []), t]);
  }
  const layers = new Map<string, number>();
  const backEdges = new Set<GraphTransitionDto>();
  const onStack = new Set<string>();

  const dfs = (name: string, depth: number) => {
    if ((layers.get(name) ?? -1) >= depth) return; // already placed at least this deep
    layers.set(name, depth);
    onStack.add(name);
    for (const t of out.get(name) ?? []) {
      if (onStack.has(t.toState)) backEdges.add(t);
      else dfs(t.toState, depth + 1);
    }
    onStack.delete(name);
  };

  const hasIncoming = new Set(transitions.map((t) => t.toState));
  const roots = states.filter((s) => s.isInitial || !hasIncoming.has(s.name));
  for (const r of roots) dfs(r.name, 0);
  for (const s of states) if (!layers.has(s.name)) layers.set(s.name, 0); // disconnected — park at the start
  return { layers, backEdges };
}

/**
 * Lay the workflow graph out as left-to-right layers: longest-path layer per state,
 * rows ordered by the mean row of each node's predecessors (one barycenter pass —
 * keeps the happy path roughly straight), pixel positions from measured pill widths.
 */
export function layoutWorkflow({ states, transitions }: { states: GraphStateDto[]; transitions: GraphTransitionDto[] }): WorkflowDiagram {
  const { drawn, collapsed } = splitCommonEdges(transitions);
  // Layer on ALL transitions (collapsed ones still say where their sink belongs).
  const { layers, backEdges } = computeLayers({ states, transitions });

  const layerCount = Math.max(...[...layers.values()], 0) + 1;
  const byLayer: GraphStateDto[][] = Array.from({ length: layerCount }, () => []);
  for (const s of states) byLayer[layers.get(s.name) ?? 0].push(s);

  // Row order: barycenter of predecessor rows, processed left to right. Ties go to
  // the node that continues the flow (non-terminal, more outgoing edges) so the
  // happy path hugs the top row and sinks hang below it.
  const row = new Map<string, number>();
  const preds = new Map<string, string[]>();
  const outDegree = new Map<string, number>();
  for (const t of drawn) {
    if (backEdges.has(t)) continue;
    preds.set(t.toState, [...(preds.get(t.toState) ?? []), t.fromState]);
    outDegree.set(t.fromState, (outDegree.get(t.fromState) ?? 0) + 1);
  }
  byLayer.forEach((nodes, layer) => {
    if (layer > 0) {
      const bary = (n: string) => {
        const p = (preds.get(n) ?? []).filter((x) => row.has(x));
        return p.length ? p.reduce((sum, x) => sum + (row.get(x) ?? 0), 0) / p.length : Number.MAX_SAFE_INTEGER;
      };
      nodes.sort((a, b) =>
        bary(a.name) - bary(b.name)
        || Number(a.isTerminal) - Number(b.isTerminal)
        || (outDegree.get(b.name) ?? 0) - (outDegree.get(a.name) ?? 0));
    }
    nodes.forEach((n, i) => row.set(n.name, i));
  });

  // Pixel positions: each layer as wide as its widest pill.
  const layerW = byLayer.map((nodes) => Math.max(...nodes.map((n) => nodeWidth(n.name)), 0));
  const layerX: number[] = [];
  let x = MARGIN;
  for (let l = 0; l < layerCount; l += 1) { layerX[l] = x; x += layerW[l] + LAYER_GAP; }

  const nodes: DiagramNode[] = states.map((s) => {
    const layer = layers.get(s.name) ?? 0;
    return {
      name: s.name, isInitial: s.isInitial, isTerminal: s.isTerminal, layer,
      x: layerX[layer], y: MARGIN + (row.get(s.name) ?? 0) * (NODE_H + ROW_GAP), w: nodeWidth(s.name), h: NODE_H,
    };
  });

  const edges: DiagramEdge[] = drawn.map((t) => ({ from: t.fromState, to: t.toState, event: t.event, back: backEdges.has(t) }));
  const maxRows = Math.max(...byLayer.map((l) => l.length), 1);
  return {
    nodes,
    edges,
    collapsed,
    width: x - LAYER_GAP + MARGIN,
    // Back edges route underneath the rows — leave them a lane.
    height: MARGIN * 2 + maxRows * (NODE_H + ROW_GAP) - ROW_GAP + (edges.some((e) => e.back) ? 44 : 0),
  };
}

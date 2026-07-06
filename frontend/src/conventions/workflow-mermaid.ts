import { GraphStateDto, GraphTransitionDto } from '../api/types';
import { splitCommonEdges, CollapsedEdge } from './workflow-diagram';

/**
 * Translate the workflow graph into mermaid `stateDiagram-v2` source. The
 * CANCEL-from-everywhere fan-in is collapsed out (same rule as the fallback SVG
 * renderer) and returned separately for the note below the drawing.
 */
export function toMermaidSource({ states, transitions }: { states: GraphStateDto[]; transitions: GraphTransitionDto[] }): { source: string; collapsed: CollapsedEdge[] } {
  const { drawn, collapsed } = splitCommonEdges(transitions);
  const lines = ['stateDiagram-v2', '  direction LR'];
  for (const s of states) if (s.isInitial) lines.push(`  [*] --> ${s.name}`);
  for (const t of drawn) lines.push(`  ${t.fromState} --> ${t.toState}: ${t.event}`);
  const terminals = states.filter((s) => s.isTerminal).map((s) => s.name);
  if (terminals.length) {
    lines.push('  classDef terminal fill:#f4f4f1,stroke:#b9b9b2,stroke-width:1.5px');
    lines.push(`  class ${terminals.join(',')} terminal`);
  }
  return { source: lines.join('\n'), collapsed };
}

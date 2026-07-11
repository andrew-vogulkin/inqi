import { GraphStateDto, GraphTransitionDto } from '../api/types';
import { splitCommonEdges, CollapsedEdge } from './workflow-diagram';

/**
 * Mermaid stateDiagram identifiers allow [A-Za-z0-9_] only — subject_build's
 * hyphenated operator names (`enrich-web-grounded`) would fail the parse and
 * knock the tab down to the fallback SVG. Alias such names to a safe id.
 */
const idOf = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, '_');

/** The scalar config entries worth drawing (genes, layer, predicate…) as `k=v` pairs. */
export function stateConfigLabel(config: Record<string, unknown> | null | undefined): string | null {
  const scalars = Object.entries(config ?? {}).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v));
  if (!scalars.length) return null;
  return scalars.map(([k, v]) => `${k}=${v}`).join(' · ');
}

/**
 * Translate the workflow graph into mermaid `stateDiagram-v2` source. The
 * CANCEL-from-everywhere fan-in is collapsed out (same rule as the fallback SVG
 * renderer) and returned separately for the note below the drawing. Per-state
 * config (tunable genes, subject_build layers/predicates) renders as an attached
 * note so a tuned version is visibly different from the baseline.
 */
export function toMermaidSource({ states, transitions }: { states: GraphStateDto[]; transitions: GraphTransitionDto[] }): { source: string; collapsed: CollapsedEdge[] } {
  const { drawn, collapsed } = splitCommonEdges(transitions);
  const lines = ['stateDiagram-v2', '  direction LR'];
  for (const s of states) if (idOf(s.name) !== s.name) lines.push(`  state "${s.name}" as ${idOf(s.name)}`);
  for (const s of states) if (s.isInitial) lines.push(`  [*] --> ${idOf(s.name)}`);
  for (const t of drawn) lines.push(`  ${idOf(t.fromState)} --> ${idOf(t.toState)}: ${t.event}`);
  for (const s of states) {
    const label = stateConfigLabel(s.config);
    if (label) lines.push(`  note right of ${idOf(s.name)}`, `    ${label}`, '  end note');
  }
  const terminals = states.filter((s) => s.isTerminal).map((s) => idOf(s.name));
  if (terminals.length) {
    lines.push('  classDef terminal fill:#f4f4f1,stroke:#b9b9b2,stroke-width:1.5px');
    lines.push(`  class ${terminals.join(',')} terminal`);
  }
  return { source: lines.join('\n'), collapsed };
}

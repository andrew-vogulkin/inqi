import { GraphStateDto, GraphTransitionDto, WorkflowInspectDto } from '../api/types';

type TunableSpec = NonNullable<WorkflowInspectDto['tunables']>[number];
import { splitCommonEdges, CollapsedEdge } from './workflow-diagram';

/**
 * Mermaid stateDiagram identifiers allow [A-Za-z0-9_] only — subject_build's
 * hyphenated operator names (`enrich-web-grounded`) would fail the parse and
 * knock the tab down to the fallback SVG. Alias such names to a safe id.
 */
const idOf = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * Report-workflow states that don't do the work themselves — they hand off to a
 * child workflow (its own IN → OUT machine). Labelled `STATE ↪ sub_workflow` and
 * styled distinctly so the diagram reads as "this step runs another workflow".
 */
const SUBWORKFLOW_REFS: Record<string, Record<string, string>> = {
  report: {
    PRE_RESEARCH: 'pre_research',
    BROAD_RESEARCH: 'breadth_search',
    FUNNEL: 'depth_search', // one depth_search run per inquiry, kicked off as the funnel assembles
  },
};

/**
 * The note text for one state: its SET scalar config entries (genes, layer,
 * predicate…) plus the registry's unset genes rendered as defaults — so a
 * baseline version still shows every knob a proposal could turn.
 */
export function stateConfigLabel(config: Record<string, unknown> | null | undefined, registry: TunableSpec[] = []): string | null {
  const scalars = Object.entries(config ?? {}).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v));
  const setKeys = new Set(scalars.map(([k]) => k));
  const defaults = registry
    .filter((t) => !setKeys.has(t.key))
    .map((t) => `${t.key}=${t.fallback ?? 'auto'} (default)`);
  const parts = [...scalars.map(([k, v]) => `${k}=${v}`), ...defaults];
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Translate the workflow graph into mermaid `stateDiagram-v2` source. The
 * CANCEL-from-everywhere fan-in is collapsed out (same rule as the fallback SVG
 * renderer) and returned separately for the note below the drawing. Per-state
 * config (tunable genes, subject_build layers/predicates) renders as an attached
 * note so a tuned version is visibly different from the baseline.
 */
export function toMermaidSource({ states, transitions, tunables = [], key }: { states: GraphStateDto[]; transitions: GraphTransitionDto[]; tunables?: TunableSpec[]; key?: string }): { source: string; collapsed: CollapsedEdge[] } {
  const subrefs = (key && SUBWORKFLOW_REFS[key]) || {};
  const { drawn, collapsed } = splitCommonEdges(transitions);
  const lines = ['stateDiagram-v2', '  direction LR'];
  // Aliased labels: a sub-workflow hand-off (STATE ↪ child), else a special-char rename.
  for (const s of states) {
    const ref = subrefs[s.name];
    if (ref) lines.push(`  state "${s.name} ↪ ${ref}" as ${idOf(s.name)}`);
    else if (idOf(s.name) !== s.name) lines.push(`  state "${s.name}" as ${idOf(s.name)}`);
  }
  for (const s of states) if (s.isInitial) lines.push(`  [*] --> ${idOf(s.name)}`); // the one IN
  for (const t of drawn) lines.push(`  ${idOf(t.fromState)} --> ${idOf(t.toState)}: ${t.event}`);
  // Every terminal exits to [*] — the OUT node, mirroring the single IN so a sub-workflow
  // reads as a closed IN→OUT machine (and the report machine's ends are explicit too).
  for (const s of states) if (s.isTerminal) lines.push(`  ${idOf(s.name)} --> [*]`);
  for (const s of states) {
    const label = stateConfigLabel(s.config, tunables.filter((t) => t.state === s.name));
    if (label) lines.push(`  note right of ${idOf(s.name)}`, `    ${label}`, '  end note');
  }
  const terminals = states.filter((s) => s.isTerminal).map((s) => idOf(s.name));
  if (terminals.length) {
    lines.push('  classDef terminal fill:#f4f4f1,stroke:#b9b9b2,stroke-width:1.5px');
    lines.push(`  class ${terminals.join(',')} terminal`);
  }
  const subflows = states.filter((s) => subrefs[s.name]).map((s) => idOf(s.name));
  if (subflows.length) {
    lines.push('  classDef subflow fill:#eef1fb,stroke:#4f46e5,stroke-width:1.5px,stroke-dasharray:5 3');
    lines.push(`  class ${subflows.join(',')} subflow`);
  }
  return { source: lines.join('\n'), collapsed };
}

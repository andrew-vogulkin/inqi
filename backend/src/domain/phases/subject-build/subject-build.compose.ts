import { z } from 'zod';
import { Ai } from './operators.runtime';
import { PALETTE, PREDICATES, SUBJECT_IN, SUBJECT_OUT } from './operators';
import { MAX_LAYERS, MAX_OPERATORS, SubjectBuildGraph } from './validate';

/** The model's proposed composition — validated by the static validator before it's used. */
const graphSchema = z.object({
  states: z.array(z.object({
    name: z.string().min(1),
    handler: z.string().optional(),
    layer: z.number().int().min(1).max(MAX_LAYERS).optional(),
    config: z.record(z.unknown()).optional(),
    isInitial: z.boolean().optional(),
    isTerminal: z.boolean().optional(),
  })).min(2),
  transitions: z.array(z.object({ from: z.string(), to: z.string(), event: z.string() })).min(1),
});

/** A compact palette description so the model composes only valid operators + events. */
function paletteDoc(): string {
  return Object.values(PALETTE)
    .map((o) => `- ${o.id} (${o.kind}): reads [${o.reads.join(', ') || '—'}] writes [${o.writes.join(', ') || '—'}] emits [${o.emits.join(', ')}]`)
    .join('\n');
}

export function composeSystem(): string {
  return [
    'You improve the SUBJECT_BUILD composition: a LAYERED OPERATOR NETWORK (like a small neural network) that turns a customer request into a searchable Subject.',
    'You compose ONLY from the registered operator palette below — you never invent operators or write code.',
    'Network semantics: states carry a "layer" (1..' + String(MAX_LAYERS) + '); edges may connect any node to any STRICTLY DEEPER node (M:M — fan-out and fan-in are encouraged).',
    'When a node emits an event, ALL out-edges labelled with that event fire; a node runs once when ANY in-edge fires, seeing every upstream write merged on the shared blackboard.',
    'Rules you MUST satisfy (a violation is rejected before it runs):',
    `- exactly one initial state named ${SUBJECT_IN} (layer 0); one terminal state named ${SUBJECT_OUT} (emits SUBJECT_CREATED).`,
    `- at most ${MAX_OPERATORS} operator states in the whole network (this is the run budget), arranged in at most ${MAX_LAYERS} layers.`,
    '- every edge goes to a strictly deeper layer (no cycles); every transition\'s event must be one the from-operator can emit.',
    '- every operator\'s reads must be written by one of its ancestors (or SUBJECT_IN); some ancestor of OUT must write draft.title, draft.summary and draft.category.',
    `- an if-else state needs config.predicate ∈ {${PREDICATES.join(', ')}}. A state may set "handler" to an operator id and reuse a distinct "name".`,
    '- prefer using the domain memory: domain-recall early (priors in), domain-learn late (learned facts out) — the layer that keeps improving information over domain subjects.',
    '',
    'Palette:',
    paletteDoc(),
  ].join('\n');
}

export function composeUser({ baseline }: { baseline: SubjectBuildGraph }): string {
  return `Current baseline composition:\n${JSON.stringify(baseline)}\n\n`
    + 'Propose a candidate composition that should build BETTER subjects (more specific titles, correct category, grounded when useful) while obeying every rule. '
    + 'Return { states, transitions }.';
}

/** Ask the model for a candidate subject_build graph. The caller validates it before rehearsing. */
export async function composeCandidate({ ai, baseline }: { ai: Ai; baseline: SubjectBuildGraph }): Promise<SubjectBuildGraph> {
  const out = await ai.structured({ system: composeSystem(), user: composeUser({ baseline }), validate: (r) => graphSchema.parse(r) });
  return out as SubjectBuildGraph;
}

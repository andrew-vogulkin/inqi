import { z } from 'zod';
import { Ai } from './operators.runtime';
import { PALETTE, PREDICATES, SUBJECT_IN, SUBJECT_OUT } from './operators';
import { MAX_OPERATORS, SubjectBuildGraph } from './validate';

/** The model's proposed composition — validated by the static validator before it's used. */
const graphSchema = z.object({
  states: z.array(z.object({
    name: z.string().min(1),
    handler: z.string().optional(),
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
    'You improve the SUBJECT_BUILD composition: a small state machine that turns a customer request into a searchable Subject.',
    'You compose ONLY from the registered operator palette below — you never invent operators or write code.',
    'Rules you MUST satisfy (a violation is rejected before it runs):',
    `- exactly one initial state named ${SUBJECT_IN}; one terminal state named ${SUBJECT_OUT} (emits SUBJECT_CREATED).`,
    `- at most ${MAX_OPERATORS} operators between IN and OUT on any path.`,
    '- every operator\'s reads must be produced by an operator earlier on the path; the path must write draft.title, draft.summary and draft.category before OUT.',
    '- every transition\'s event must be one the from-operator can emit.',
    `- an if-else state needs config.predicate ∈ {${PREDICATES.join(', ')}}. A state may set "handler" to an operator id and reuse a distinct "name".`,
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

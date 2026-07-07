/**
 * The subject_build operator palette — the fixed set the AI composes from (option
 * b: it wires these, it does not implement them). Each operator declares a typed
 * read/write contract over the shared `draft` (see docs/subject-build-slot.md), so
 * a composition can be validated before it ever runs.
 *
 * Behaviour + static prompts live with the handlers (built later); this file is the
 * data the validator + the AI reason over.
 */

/** Draft/context field tokens operators read and write (the shared `PhaseRun.data`). */
export const Field = {
  RawRequest: 'rawRequest',
  Enriched: 'enriched',
  Title: 'draft.title',
  Category: 'draft.category',
  Summary: 'draft.summary',
  Attributes: 'draft.attributes',
  Interpretation: 'draft.interpretation',
  ReusedFrom: 'draft.reusedFrom',
  Evidence: 'evidence',
  ReferenceSet: 'referenceSet',
  Toolset: 'toolset',
} as const;
export type Field = (typeof Field)[keyof typeof Field];

/** What SUBJECT_IN makes available, and what SUBJECT_OUT requires to persist a Subject. */
export const IN_PROVIDES: Field[] = [Field.RawRequest, Field.Enriched];
export const OUT_REQUIRES: Field[] = [Field.Title, Field.Summary, Field.Category];

export type OperatorKind = 'entry' | 'exit' | 'builder' | 'context' | 'control';

export interface OperatorSpec {
  id: string;
  kind: OperatorKind;
  reads: Field[];   // must be produced upstream (IN or an earlier operator)
  writes: Field[];  // added to the available set for downstream operators
  emits: string[];  // events this operator can raise (the transitions it can drive)
}

export const SUBJECT_IN = 'SUBJECT_IN';
export const SUBJECT_OUT = 'SUBJECT_OUT';

/** Registered if-else predicates (referenced by id in a state's config; no free expressions). */
export const PREDICATES = ['low-confidence', 'has-draft', 'category-is-service', 'has-reference-set'] as const;
export type Predicate = (typeof PREDICATES)[number];

const OPERATORS: OperatorSpec[] = [
  { id: SUBJECT_IN, kind: 'entry', reads: [], writes: IN_PROVIDES, emits: ['READY'] },
  { id: 'enrich-basic', kind: 'builder', reads: [Field.RawRequest, Field.Enriched], writes: [Field.Title, Field.Category, Field.Summary], emits: ['DRAFTED'] },
  { id: 'enrich-web-grounded', kind: 'builder', reads: [Field.RawRequest], writes: [Field.Title, Field.Category, Field.Summary, Field.Evidence], emits: ['DRAFTED'] },
  { id: 'reuse-lookup', kind: 'builder', reads: [Field.Title], writes: [Field.ReusedFrom, Field.Summary], emits: ['REUSED', 'NO_REUSE'] },
  { id: 'category-specialize', kind: 'builder', reads: [Field.Category, Field.RawRequest], writes: [Field.Attributes], emits: ['SPECIALIZED'] },
  { id: 'self-critique', kind: 'builder', reads: [Field.Title], writes: [Field.Title, Field.Summary, Field.Category], emits: ['REFINED'] },
  { id: 'disambiguate', kind: 'builder', reads: [Field.RawRequest], writes: [Field.Interpretation], emits: ['CLEAR', 'AMBIGUOUS'] },
  { id: 'target-industry-set', kind: 'context', reads: [Field.RawRequest], writes: [Field.ReferenceSet], emits: ['SET'] },
  { id: 'tooling', kind: 'context', reads: [], writes: [Field.Toolset], emits: ['BOUND'] },
  { id: 'if-else', kind: 'control', reads: [], writes: [], emits: ['THEN', 'ELSE'] },
  { id: SUBJECT_OUT, kind: 'exit', reads: OUT_REQUIRES, writes: [], emits: ['SUBJECT_CREATED'] },
];

export const PALETTE: Record<string, OperatorSpec> = Object.fromEntries(OPERATORS.map((o) => [o.id, o]));

/** The seeded v1 graph reproduces today's behaviour: IN → enrich-basic → OUT. */
export const DEFAULT_GRAPH = {
  states: [
    { name: SUBJECT_IN, isInitial: true },
    { name: 'enrich-basic' },
    { name: SUBJECT_OUT, isTerminal: true },
  ],
  transitions: [
    { from: SUBJECT_IN, to: 'enrich-basic', event: 'READY' },
    { from: 'enrich-basic', to: SUBJECT_OUT, event: 'DRAFTED' },
  ],
} as const;

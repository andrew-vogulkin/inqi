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
  Domain: 'domain',
  DomainPriors: 'domainPriors',
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
export const PREDICATES = ['low-confidence', 'has-draft', 'category-is-service', 'has-reference-set', 'has-domain-priors'] as const;
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
  // Domain memory — the network's read head (priors in) and write head (learned facts out).
  { id: 'domain-recall', kind: 'context', reads: [Field.RawRequest], writes: [Field.Domain, Field.DomainPriors], emits: ['RECALLED', 'NO_PRIORS'] },
  { id: 'attribute-mine', kind: 'builder', reads: [Field.RawRequest, Field.Title], writes: [Field.Attributes], emits: ['MINED'] },
  { id: 'domain-learn', kind: 'builder', reads: [Field.Title, Field.Category], writes: [], emits: ['LEARNED'] },
  // Explicit fan-in point for layered networks — pure pass-through, keeps wide graphs readable.
  { id: 'join', kind: 'control', reads: [], writes: [], emits: ['MERGED'] },
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

/**
 * The seeded v2 layered NETWORK (docs/subject-build-network.md §5): 7 operators
 * in 4 layers with M:M edges. IN fans out 1:3 (parallel perspectives), the
 * drafting layer fans in 3:1, refinement fans out 1:2 and the memory write head
 * fans in 2:1 before OUT. `layer` rides in state config (no schema change).
 */
export const LAYERED_GRAPH_V2 = {
  states: [
    { name: SUBJECT_IN, isInitial: true },
    { name: 'disambiguate', config: { layer: 1 } },
    { name: 'target-industry-set', config: { layer: 1 } },
    { name: 'domain-recall', config: { layer: 1 } },
    { name: 'enrich-web-grounded', config: { layer: 2 } },
    { name: 'attribute-mine', config: { layer: 3 } },
    { name: 'self-critique', config: { layer: 3 } },
    { name: 'domain-learn', config: { layer: 4 } },
    { name: SUBJECT_OUT, isTerminal: true },
  ],
  transitions: [
    { from: SUBJECT_IN, to: 'disambiguate', event: 'READY' },
    { from: SUBJECT_IN, to: 'target-industry-set', event: 'READY' },
    { from: SUBJECT_IN, to: 'domain-recall', event: 'READY' },
    { from: 'disambiguate', to: 'enrich-web-grounded', event: 'CLEAR' },
    { from: 'disambiguate', to: 'enrich-web-grounded', event: 'AMBIGUOUS' },
    { from: 'target-industry-set', to: 'enrich-web-grounded', event: 'SET' },
    { from: 'domain-recall', to: 'enrich-web-grounded', event: 'RECALLED' },
    { from: 'domain-recall', to: 'enrich-web-grounded', event: 'NO_PRIORS' },
    { from: 'enrich-web-grounded', to: 'attribute-mine', event: 'DRAFTED' },
    { from: 'enrich-web-grounded', to: 'self-critique', event: 'DRAFTED' },
    { from: 'attribute-mine', to: 'domain-learn', event: 'MINED' },
    { from: 'self-critique', to: 'domain-learn', event: 'REFINED' },
    { from: 'domain-learn', to: SUBJECT_OUT, event: 'LEARNED' },
  ],
} as const;

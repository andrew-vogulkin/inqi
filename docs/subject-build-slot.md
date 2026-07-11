# Subject-build slot — a sandbox sub-workflow the AI experiments with

> **v2 (2026-07-11):** the slot is now a **layered M:M operator network** with
> persistent domain memory, and the operator budget is **10** (was 5). This doc
> remains the base contract; the network semantics, new operators
> (`domain-recall`, `attribute-mine`, `domain-learn`, `join`) and the seeded v2
> graph live in [subject-build-network.md](subject-build-network.md).

Today the pre_research `SUBJECT` step is a single naive handler: it takes
FEASIBILITY's enrichment and writes a `Subject`, falling back to
`title = rawRequest.slice(0, 80)`. Everything downstream (questionnaire, breadth,
depth) keys off the Subject, so it is a high-leverage step with obvious room to
improve — and a clean contract to open up.

This doc specifies **`subject_build`**: a new phase workflow (a child of
`pre_research`, exactly as `depth_search` is a child of `report`) that turns
`SUBJECT` into a **sandbox slot** — a region with a frozen entry contract and a
required exit invariant, inside which the AI composes a graph of operators and
tunes their params, gated by rehearsal. The AI never writes prompt text or code;
it wires a palette we author.

Source of truth (to build): `backend/src/domain/phases/subject-build.steps.ts`
(operator handlers), `subject-operators.ts` (palette registry + static prompts),
`subject-build-graph.ts` (seeded default graph), plus the shared
`phase-graphs.ts` / `PhaseEngine`. Parent bridge lives in
`pre-research.steps.ts` (`SUBJECT` state → start + await `subject_build`).

## The slot

```
FEASIBILITY ─FEASIBILITY_OK→ SUBJECT (bridge: start subject_build, await terminal)
                                   │
        subject_build:             ▼
        SUBJECT_IN ─▶ [ ≤ 5 operators, AI-composed ] ─▶ SUBJECT_OUT
          (initial)                                     (terminal → SUBJECT_CREATED)
                                   │
             pre_research: SUBJECT ─SUBJECT_CREATED→ QUESTIONNAIRE_GEN
```

- **SUBJECT_IN** — precondition (frozen): report + `enriched {title?,category?,summary?}` + rawRequest are available.
- **SUBJECT_OUT** — postcondition invariant (enforced): a valid `Subject` is persisted for `reportId` (`title` + `description` non-empty, a `category`). If the composition doesn't satisfy it, OUT fails cleanly (`STEP_FAILED`) — the experiment is rejected, the outer machine is untouched.

## The `draft` contract

Every builder operator reads and writes ONE evolving object in `PhaseRun.data`.
This shared shape is the *type* that lets operators compose and lets the validator
reason about them.

```ts
interface SubjectBuildData {
  // inputs (from SUBJECT_IN, read-only)
  rawRequest: string;
  enriched?: { title?: string; category?: string; summary?: string };

  // the evolving subject the operators fill/refine
  draft: {
    title?: string;
    category?: string;         // item | service | rental | organisation | goods | trade
    summary?: string;          // becomes Subject.description
    attributes?: Record<string, unknown>;
    interpretation?: string;   // chosen reading of an ambiguous request
    reusedFrom?: string;       // prior ReportSnapshot id, if adapted
    confidence?: number;       // 0..1, operators may set/raise
  };

  // context set up by context operators, consumed by builders
  evidence?: { url: string; snippet: string }[];
  referenceSet?: string[];     // curated domain sources to consult
  toolset?: string[];          // tool ids in scope for this run

  // engine bookkeeping (not authored)
  stepCount: number;           // operators executed so far (see the ≤5 cap)
  notes: string[];
}
```

`SUBJECT_OUT` maps `draft` → `subjects.createFromReport` (idempotent;
`Subject.reportId` is unique).

## The operator palette

Operators are **code**, registered `(‘subject_build’, STATE) → handler`, with the
static prompt authored beside the handler. The AI composes references to these; it
does not implement them.

| Operator (state) | Kind | reads → writes | emits | Prompt |
|---|---|---|---|---|
| `SUBJECT_IN` | entry | `{rawRequest, enriched}` → — | `READY` | — |
| `enrich-basic` | builder | `{rawRequest, enriched}` → `draft.{title,category,summary}` | `DRAFTED` | static (today's) |
| `enrich-web-grounded` | builder | `{rawRequest, referenceSet?, toolset?}` → `draft.*, evidence[]` | `DRAFTED` | static |
| `reuse-lookup` | builder | `{draft}` → `draft.{reusedFrom, ...}` | `REUSED` / `NO_REUSE` | static + pgvector lookup |
| `category-specialize` | builder | `{draft.category, rawRequest}` → `draft.attributes` | `SPECIALIZED` | static (per category) |
| `self-critique` | builder | `{draft}` → `draft.*` (refined) | `REFINED` | static |
| `disambiguate` | builder | `{rawRequest}` → `draft.interpretation` | `CLEAR` / `AMBIGUOUS` | static |
| `target-industry-set` | context | `{draft.category \| rawRequest}` → `referenceSet` | `SET` | data-driven map |
| `tooling` | context | `config` → `toolset` | `BOUND` | none (config) |
| `if-else` | control | registered predicate over `draft`/data | `THEN` / `ELSE` | none (predicate id) |
| `SUBJECT_OUT` | exit | `{draft}` → persists `Subject` | `SUBJECT_CREATED` | validator only |

Notes:

- **`if-else` is native to the state machine.** Branching = a decision state that
  emits one of several *events*, each routed by a transition (unique key
  `(definitionId, fromState, event)`). Its `config` selects a **registered
  predicate** (`{ predicate: 'low-confidence', threshold: 0.5 }`) — the same
  "reference code by name" mechanism as `guard`/`action`.
- **Context operators** (`target-industry-set`, `tooling`) don't touch the subject
  — they set up `referenceSet` / `toolset` that builder operators consume. The
  industry → reference-set mapping is tunable **data** (config/table), not a prompt.
- **Ordering constraints fall out of the I/O types** — `reuse-lookup` reads
  `draft`, so it must follow a builder; `category-specialize` needs
  `draft.category`. The validator enforces this (see below).

## Storage model

| Piece | Stored in | Author |
|---|---|---|
| operator behavior + static prompt | code (registry + prompt beside handler) | us |
| the **composition** (which operators, wired how) | `WorkflowState` + `WorkflowTransition` rows, versioned under a `subject_build` `WorkflowDefinition` | **AI** (rehearsal-gated) |
| operator **params** (`maxQueries`, `rounds`, predicate, industry) | `WorkflowState.config` (Json — schema delta below) | **AI** |
| industry → reference-set map | config/table (data) | us / AI-tunable later |
| run-time scratchpad (`draft`, evidence…) | `PhaseRun.data` (one row per run) | engine |

An "experiment" is therefore just a new `subject_build` **version** = a fresh set
of State/Transition rows (+ per-state `config`). It renders in `/admin/workflows`,
diffs via `diffVersions`, and publishes via the existing validated `publish` path.

### Schema delta

`WorkflowState` gains two optional columns so a state is a first-class **operator
instance** = `{ operator, params }`:

```prisma
model WorkflowState {
  // ...existing: name, isInitial, isTerminal
  handler String?  // operator id; defaults to `name`
  config  Json?    // operator params the AI tunes, e.g. { maxQueries: 3, rounds: 2, predicate: 'low-confidence' }
}
```

Dev-only DB → `prisma db push` + reseed (the established flow). No change to
`WorkflowTransition` (its `guard`/`action` already reference code by name).

## Validator rules

Static checks extend `validateWorkflowGraph` and run **before** anything executes
(cheap rejection), on top of the generic graph checks (one initial state,
terminals reachable, no dangling transitions):

1. **Bounded slot** — the only initial state is `SUBJECT_IN`; the only success
   terminal is `SUBJECT_OUT` (emitting `SUBJECT_CREATED`). Plus the shared
   `STEP_FAILED → FAILED` / `CANCEL → CANCELLED` terminals.
2. **Typed I/O reachability** — on every acyclic IN→OUT path, each operator's
   `reads` are produced by an upstream operator (or SUBJECT_IN). e.g. a path with
   `reuse-lookup` before any builder is rejected.
3. **Invariant reachability** — every path to `SUBJECT_OUT` writes
   `draft.{title, summary, category}` (the persist invariant) at least once.
4. **Registered operators only** — every state's `handler` (or `name`) resolves to
   a registered operator; every `if-else` predicate resolves to a registered
   predicate. (No new code via composition — that is a separate, code-reviewed step.)
5. **≤ 5 operators between IN and OUT** — see below.

### The ≤ 5 cap (hard rule, enforced two ways)

*In any way, no more than 5 operators run between IN and OUT.* Enforced both
structurally and at run time so loops can't escape it:

- **Structural (static):** every acyclic path from `SUBJECT_IN` to `SUBJECT_OUT`
  passes through **≤ 5 operator states** (states other than IN/OUT). Computed by a
  longest-acyclic-path check in the validator; a graph that can route through 6+
  operators fails to publish.
- **Runtime (covers loops):** the engine increments `data.stepCount` on each
  operator execution; on the **6th**, it forces the machine to `SUBJECT_OUT`
  (persist if the invariant holds) or `STEP_FAILED` (if not). This bounds
  `self-critique` / `if-else` loops regardless of graph shape.

Rationale: a subject is worth a handful of focused operations, not an unbounded
agent loop — the cap keeps every experiment cheap, fast, and comparable, and keeps
the search space the AI explores small enough to rehearse thoroughly.

## Safety gates (cheap → expensive)

1. **Static validator** (instant, free): rules 1–5 above. A malformed or oversized
   composition never runs.
2. **Rehearsal** (the harness, `infra/rehearsal/`): compositions that pass #1 run
   the golden set with the web frozen + model live; the scorer measures whether the
   better subject yields better *downstream* breadth/depth (more/better qualified
   providers), plus cost/latency. Baseline-vs-candidate diff.
3. **Operator approval**: the scorecard + graph diff surface in `/admin`; a human
   publishes the winning version. (Autonomy can loosen later.)

## Default seeded graph (v1)

The migration seeds a v1 that reproduces today's behaviour, so nothing changes
until the AI proposes a better version:

```
SUBJECT_IN ─READY→ enrich-basic ─DRAFTED→ SUBJECT_OUT
```

A plausible early experiment (well within the cap):

```
SUBJECT_IN ─READY→ disambiguate ─(CLEAR|AMBIGUOUS)→ target-industry-set ─SET→
enrich-web-grounded ─DRAFTED→ reuse-lookup ─(REUSED|NO_REUSE)→ SUBJECT_OUT
```
(4 operators between IN and OUT.)

## Open items

- The runtime step-count cap belongs in `PhaseEngine` generically (any phase can
  opt into a per-run operator budget), or as a `subject_build`-specific guard.
- `WorkflowState.handler/config` touches the generic engine's state lookup — decide
  whether `handler` defaulting to `name` is enough for all phases or subject-only.
- Reference-set data model (config blob vs a `ReferenceSet` table the AI can tune)
  — defer until `target-industry-set` is built.
- `reuse-lookup` reuses the (now-fixed) `findReusableCandidates`; decide clone-vs-adapt
  policy when a near-identical prior subject is found.
```

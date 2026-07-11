# subject_build v2 — a layered M:M operator network with domain memory

Extends [subject-build-slot.md](subject-build-slot.md). Every constraint of the
slot **stays in force** — frozen IN/OUT boundary, registered-palette-only
composition, typed I/O validation, the persist invariant, the strict-gain
rehearsal gate, draft-only proposals. What changes: the composition inside the
slot grows from a single walked path into a **layered network** (nodes with M:M
connections, executed like a neural network's forward pass), the operator budget
rises **5 → 10**, and the layer gains **persistent, self-improving memory over
domain subjects**.

## 1. Motivation

- The linear walk runs exactly one operator per step and forgets everything
  between runs. Every wedding-venue request re-derives what a wedding venue is.
- A path can't combine perspectives: `disambiguate`, `target-industry-set` and a
  domain recall are all *useful before drafting*, but a path forces them into a
  serial chain that eats the whole budget.
- The slot has no way to **keep and improve information about domain subjects**:
  nothing learned while building one Subject survives to the next.

## 2. Shape: layers + M:M edges

A composition is now a **DAG arranged in layers**, like a small MLP:

- `SUBJECT_IN` is layer 0; `SUBJECT_OUT` terminates the network.
- Operator nodes carry a `layer` (1..**10**), stored in `WorkflowState.config.layer`
  (no schema change — legacy graphs without layers still load).
- **Edges are M:M across all layers**: any node may feed any number of
  deeper-layer nodes (fan-out), and be fed by any number of shallower-layer
  nodes (fan-in). Skip connections (layer 1 → layer 4) are allowed; edges must
  strictly **increase** layer, which is what keeps the network acyclic.
- Edges keep their event labels. This is where branching survives: `if-else`
  still emits `THEN` **or** `ELSE`, and only edges labelled with the emitted
  event fire. The semantic change is that **all** matching out-edges fire, not
  just the first — one `DRAFTED` can feed three downstream nodes at once.

### Execution: the forward pass

The interpreter runs the network **layer-synchronously**, like an NN inference:

1. Run `SUBJECT_IN` (emits `READY`).
2. For each layer 1..N in order, for each node in the layer (declaration
   order): the node **activates** iff at least one in-edge fired (its source
   node activated and emitted that edge's event). An activated node runs once —
   fan-in is a single execution over the shared blackboard, with every upstream
   write already merged.
3. All operators share one blackboard (`PhaseRun.data` — the same
   `SubjectBuildData`), merged in deterministic order (layer, then declaration).
4. `SUBJECT_OUT` activates iff any of its in-edges fired; it enforces the
   persist invariant exactly as before.

A node that fails (`STEP_FAILED`) simply doesn't activate its out-edges — one
dead branch never kills the pass (operators are already fail-open). If no path
reaches OUT, the run is `created: false` and the caller falls back to the naive
subject, exactly as today.

**Legacy graphs keep working.** A graph with cycles (the old `self-critique`
loop shape) is executed by the original single-path walk; an acyclic graph
without explicit layers has them derived (longest distance from IN). The seeded
v1 (`IN → enrich-basic → OUT`) behaves identically under either engine.

### The budget: 5 → 10 (same constraint, new number, one clarification)

*No more than 10 operators run between IN and OUT*, enforced exactly as before:

- **Static:** in layered mode, at most **10 operator nodes reachable from
  `SUBJECT_IN`** (this bounds the worst-case activations of a whole pass, which
  is the M:M generalisation of the old per-path cap). In legacy mode, the old
  rule verbatim: ≤ 10 operators on any acyclic IN→OUT path.
- **Runtime:** `data.stepCount` still counts every operator execution; the 11th
  is refused (`STEP_FAILED` / stop scheduling), so loops or any validator gap
  can't escape the budget.
- Layers are capped at **10** (`MAX_LAYERS`), widths bounded by the same
  10-node total — a 10-layer chain, a 3×3 grid + 1, or anything in between.

### Typed I/O in a DAG

The old rule ("reads must be produced upstream on the path") generalises to
**ancestors**: a node's `reads` must be satisfiable by `SUBJECT_IN` plus the
union of `writes` of its ancestor nodes (nodes with an edge-path into it).
`SUBJECT_OUT`'s requires (`draft.title/summary/category`) must be satisfied by
its ancestors. Same conservative, statically-checkable guarantee, same
validator style, DAG-shaped.

## 3. Domain memory: keep + improve information over domain subjects

New persistent store, read at the top of the network and written at the bottom —
so every build makes the next build of the same domain better:

```prisma
model DomainKnowledge {
  id         String   @id @default(cuid())
  domain     String   @unique   // 'weddings-events', 'trades-home', … (reference-set labels + learned slugs)
  category   String?            // dominant SubjectCategory seen for this domain
  attributes Json     @default("{}")  // accumulated attribute schema/facts buyers filter on
  sources    Json     @default("[]")  // learned good sources (string[], capped)
  titleHints Json     @default("[]")  // exemplar titles of past builds (string[], capped)
  buildCount Int      @default(0)     // how many Subjects taught this row
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

> Dev DBs: the table is created via SQL (`prisma/sql/init.sql`), **never**
> `prisma db push` (which would drop the unmodelled `Subject.embedding` vector).

The blackboard gains two fields the new operators trade in:

```ts
domain?: string;                      // resolved domain label for this request
domainPriors?: {                      // what past builds of this domain learned
  attributes: Record<string, unknown>;
  sources: string[];
  titleHints: string[];
  buildCount: number;
};
```

## 4. New operators (palette additions)

| Operator | Kind | reads → writes | emits | What it does |
|---|---|---|---|---|
| `domain-recall` | context | `rawRequest` → `domain, domainPriors` | `RECALLED` / `NO_PRIORS` | Resolves the domain label (reference-set match, else category slug) and loads the `DomainKnowledge` row — the network's read head. |
| `attribute-mine` | builder | `rawRequest, draft.title` → `draft.attributes` | `MINED` | LLM-extracts buyer-filterable attributes, using `domainPriors.attributes` keys as the schema hint — priors make it sharper every build. |
| `domain-learn` | builder | `draft.title, draft.category` → — | `LEARNED` | Merges the finished draft back into `DomainKnowledge` (attributes ∪, sources ∪ evidence hosts, title exemplars, buildCount++) — the write head. Rehearsals run it against a no-op sink so experiments never pollute memory. |
| `join` | control | — → — | `MERGED` | Explicit fan-in synchronisation point; pure pass-through that makes wide networks readable. |

Plus one predicate: **`has-domain-priors`** (the domain has taught us something
before, `buildCount > 0`) — lets `if-else` route cold-start requests differently
from well-known domains.

Existing prompts learn to use the memory: `enrich-web-grounded` now folds
`domainPriors` (title exemplars + learned sources) into its grounding context.

## 5. Seeded v2 network (active on dev)

7 operators, 4 layers, M:M throughout — well inside every cap:

```
            layer 1                      layer 2              layer 3            layer 4
          ┌ disambiguate ──CLEAR/AMBIG ┐
SUBJECT_IN├ target-industry-set ──SET──┼▶ enrich-web-grounded ┬▶ attribute-mine ─MINED──┐
  (READY) └ domain-recall ─RECALLED/──-┘        (DRAFTED)     └▶ self-critique ─REFINED─┴▶ domain-learn ─LEARNED▶ SUBJECT_OUT
                           NO_PRIORS
```

- L1 fans **out** of IN 1:3 (one `READY` fires three edges) — analysis,
  reference sources, and memory recall run as parallel perspectives.
- L2 fans **in** 3:1 — the drafting node sees interpretation + referenceSet +
  priors already merged on the blackboard.
- L3 fans out 1:2 and L4 fans in 2:1 — attributes and critique refine the same
  draft, then the network **writes what it learned back** before persisting.

## 6. More example networks

**Cold-start router** (predicate-driven M:M): known domains draft straight from
memory; unknown domains pay for web grounding — 6 operators.

```
IN ─READY→ domain-recall ─▶ if-else{has-domain-priors}          (L1, L2)
   THEN → enrich-basic(+priors) ─DRAFTED→ attribute-mine ─┐     (L3, L4)
   ELSE → target-industry-set ─SET→ enrich-web-grounded ──┴→ domain-learn → OUT
```

**Wide committee** (max-width layer): three drafting perspectives merged by
critique — the closest shape to a real NN layer, 6 operators.

```
IN ─READY→ { enrich-basic, enrich-web-grounded, disambiguate }   (L1, width 3)
  all → join ─MERGED→ self-critique ─REFINED→ domain-learn → OUT (L2, L3, L4)
```

**Deep refiner** (max-depth chain): the full 10-operator budget as a 10-layer
pipeline — recall → disambiguate → reference-set → ground → mine → critique →
reuse-lookup → specialize → learn → (tooling) → OUT.

## 7. What the proposer/composer sees

`composeSystem` teaches the model the new rules (10-op budget, layers 1..10,
strictly-deeper edges, ALL matching edges fire, the new operators + predicate)
and the schema accepts `layer` per state. The rehearsal gate is unchanged:
candidate networks run the golden set against the active baseline and draft
only on a **strict win** — memory writes stubbed, so rehearsal stays pure.

## 8. Rollout

1. Code: validator + interpreter + operators + prompts (this branch).
2. `DomainKnowledge` table via SQL on local + dev (no `db push`).
3. Seed v2 layered network as the active `subject_build` (v1 kept for
   rollback/diff in /admin/workflows).
4. Live examples on dev: run requests across three domains, show the layered
   path in the report log + `DomainKnowledge` accumulating (`buildCount`,
   sources, title hints), and a second build of the same domain consuming its
   priors.

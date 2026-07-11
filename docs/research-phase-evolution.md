# Research-phase evolution — self-improvement for breadth_search and depth_search

subject_build already has an autonomy dial: on each `REPORT_DELIVERED`, the
workflow engine rolls `shouldPropose` (default **0.05** — `SUBJECT_BUILD_PROPOSE_PROB`;
raise to 0.10 to match the intended 10%) and, on a hit, composes a candidate,
validates it statically, rehearses it against the golden cases, and DRAFTS a
strict winner for operator publish. This doc extends the same loop to
**breadth_search** and **depth_search**.

## Why they need a different treatment than subject_build

subject_build is *interpreted* inline and acyclic-friendly; breadth and depth are
**engine-run** phase workflows (PhaseEngine + pg-boss) whose value lives in their
**loops** (CHECKPOINT→RELAX→SEARCH, GATE→INVESTIGATE) and in their **step
handlers' parameters**, not in exotic wiring. Two consequences:

1. **Determinism is law.** The publish gate now rejects any engine-run graph with
   two transitions on the same `(state, event)` (`ambiguousTransitions` — added
   when the DB unique key widened for subject_build fan-out). Candidate graphs
   here stay classic state machines; no M:M.
2. **The leverage is in the knobs.** Pool caps, dry thresholds, cycle caps,
   web-room, evidence floors, refine policy — today hardcoded constants. That is
   where a proposal can actually win cases, and where a bad proposal is bounded
   by construction.

So the proposal is staged: **parameter evolution first** (tiny blast radius,
immediately useful), **guarded recomposition second** (same palette discipline
as subject_build, minus fan-out).

## The trigger (shared dial, per-phase probability)

Generalize `subject-build.trigger.ts` into a phase-generic
`propose.trigger.ts`:

```ts
export const PROPOSE_PROBABILITY: Record<ProposablePhase, number> = {
  subject_build:  prob('SUBJECT_BUILD_PROPOSE_PROB', 0.10),
  breadth_search: prob('BREADTH_PROPOSE_PROB', 0.10),
  depth_search:   prob('DEPTH_PROPOSE_PROB', 0.10),
};
```

On `REPORT_DELIVERED` the engine rolls **independently per phase** (a delivery
can trigger zero..three proposals) and enqueues `propose_breadth_search` /
`propose_depth_search` jobs next to the existing `propose_subject_build`.
`=0` is the per-phase kill switch. Proposals still cost one rehearsal each, so
the dials stay low; the gate + operator publish remain the real throttle.

## Stage 1 — parameter evolution (the "tuning genes")

Each phase declares a **registry of tunable parameters** with hard bounds — the
AI proposes values, never code:

| Phase | Gene | Today | Bounds |
|---|---|---|---|
| breadth | `poolCap` (search results kept/cycle) | 24 | 8..40 |
| breadth | `dryRoundsToStop` | 2 | 1..4 |
| breadth | `maxCycles` | pinned at startRun | 2..8 |
| breadth | `evidenceFloor` (facts needed to keep a candidate) | current floor | 0..3 |
| breadth | `widenBatch` | WIDEN_BATCH | 1..6 |
| breadth | `queryStyle` (enum: literal / relaxed-first / bilingual) | literal | enum |
| depth | `maxCycles` | pinned at startRun | 1..6 |
| depth | `webRoom` (tool budget/inquiry) | computed | 2..12 |
| depth | `leadsCap` | 12 | 4..20 |
| depth | `stallPolicy` (enum: gaps-key / gaps-count / never) | gaps-key | enum |
| depth | `queriesPerCycle` | current | 1..5 |

- **Stored** in the phase's `WorkflowState.config` (schema already supports it;
  this is exactly the "operator params" cell of the subject-build storage
  table). `startRun` already pins caps into `run.data` — it starts reading them
  from the active definition's config instead of constants.
- **Validated** by a `validatePhaseTunables(key, graph)` pass at publish: every
  gene within bounds, unknown keys rejected. Composition itself untouched in
  stage 1 — the candidate is *the same graph with different config*.
- **Composed** by a model prompt that sees: the registry (name, meaning, bounds,
  current value) + the last rehearsal scorecard + recent run telemetry (cycles
  used, dry rounds, cost per qualified candidate). It returns a config delta.

## Stage 2 — guarded recomposition

Once stage 1 is boring, allow the model to rewire within the subject_build
rule-set adapted to engine graphs:

- states resolve to **registered step handlers only** (the palette = the
  handlers already in `breadth-search.steps.ts` / `depth-search.steps.ts`, plus
  any new ones we author); every transition event ∈ that handler's emit set.
- frozen boundary: the initial state and the terminal set are fixed (the parent
  bridges — `phase:breadth-complete`, `inquiry:research-failed` — depend on
  them); every working state keeps its `STEP_FAILED`/`CANCEL` rows.
- loops allowed (they are the point) but **every back-edge must carry a
  cycle-cap guard** (`breadth:under-cycle-cap` / `depth:under-cycle-cap`), and
  the runtime budget in `run.data` stays the enforcement of last resort.
- **no duplicate `(state, event)`** — the `ambiguousTransitions` publish gate.

## The gate: cassette rehearsal against the golden set

This is where breadth/depth are actually *better off* than subject_build: the
harness already exists (`infra/rehearsal/` — cassettes, `RehearsalRunner`,
`goldenSet()` with 10 expectation-bearing cases, scorer). The proposer runs:

1. Baseline scorecard: golden set in **replay** (web frozen, model live), current
   active definition.
2. Candidate scorecard: same cassettes, `RunOptions.config` = the proposed genes
   (stage 1) or the candidate graph (stage 2). `onMiss: 'live'` so a candidate
   that searches *differently* may fetch new evidence (which then extends the
   cassette).
3. **Strict-gain acceptance**, phase-shaped:
   - no case regresses (an expectation that passed still passes — incl.
     `mustDeny` / `mustFailGracefully`: an "improvement" that fabricates
     providers on porsche-global is dead on arrival);
   - AND at least one expectation gained **or** — new for loops — equal
     expectations at **≥20% lower cost** (model tokens + web calls + cycles,
     from the scorer's run outcome). Cheaper-same-quality is a real win for
     breadth/depth in a way it isn't for subject_build.
4. Winner → `saveDraftPhaseVersion` (next version, status `draft`) →
   `/admin/workflows` diff → human publish. Never auto-published. In-flight
   runs stay pinned to their version; only new runs pick the published one.

One new piece of harness: **narrow drivers**. The current `PipelineDriver` runs
a case through the whole research core, which makes attribution mushy and
rehearsal expensive. Add `BreadthDriver` (subject in → funnel candidates out)
and `DepthDriver` (inquiry + known facts in → verdict out) so a breadth
proposal is scored on breadth outcomes, in minutes not tens of minutes. The
full-pipeline driver stays as the final pre-publish smoke for the winner.

## Memory tie-in (optional stage 3)

`DomainKnowledge` (the subject_build network's memory) already accumulates
learned sources per domain. Breadth's `queryStyle`/search step can consume
`domainPriors.sources` the way it consumes reference sets — then the three
phases share one improving memory instead of three private ones.

## Safety recap

Unchanged from subject_build, per phase: static validation (bounds + graph
rules + determinism) → frozen-web rehearsal with regression-first acceptance →
draft-only output → operator publish → runtime caps bound whatever was
published → env dial to zero to switch a phase's evolution off.

## Build order

1. `propose.trigger.ts` generalization + the two proposer services (mirror
   `SubjectBuildProposerService`; enqueue on delivery).
2. Tunable registries + `validatePhaseTunables` + startRun/handlers reading
   config over constants (behaviour-neutral defaults = today's values).
3. `BreadthDriver` / `DepthDriver` + per-phase expectations in the scorer;
   record cassettes for the golden cases that lack them.
4. Stage-1 composer prompts + rehearse + draft path; `/admin/workflows` needs
   nothing new (diff/publish are generic).
5. Stage 2 only after stage-1 wins land: palette registry for step handlers +
   the adapted graph rules in the publish gate.

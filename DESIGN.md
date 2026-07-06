# inqi — AI-Driven Inquiry & Research Workflow

> Hand a long, tedious "find me X" task to AI agents. They pre-research, vet it,
> ask the customer to confirm scope, then fan out to real subject providers (email for
> now), gather options, and return a cost/constraints report — with minimal to no
> human involvement.

This document is the source of truth for the architecture. It is intentionally
opinionated so the scaffold in this repo is coherent. Sections marked **(v1)**
are in the initial scaffold; **(later)** are designed-for but stubbed.

> **Terminology migration (2026-07-02):** the data model was restructured to
> **Report 1:M Inquiry 1:M Source**. What this document calls an *Inquiry* (the
> root customer request) is now the **Report** (with a 1:1 persona carrying all
> interaction); a *Subtask* (one candidate under investigation) is now an
> **Inquiry**; each channel touchpoint of an inquiry (websearch page, ratings
> digest, email thread, whatsapp) is a typed **Source** row — thread channels
> anchor the Message store and reply address. The old *Report* snapshot table is
> now **ReportSnapshot** (`/snapshots/:token`, unlock at `/snapshots/:id/unlock`).
> Sections below still use the old names pending a full rewrite; the schema,
> code, and README are already on the new model.

---

## 1. Product flow (what the system does)

A single customer request ("inquiry") moves through a versioned state machine:

```
RECEIVED
  └─> PRE_RESEARCH            AI enriches subject + ethical/feasibility eval
        ├─> DENIED            (terminal) unethical / impossible / out of scope
        └─> QUESTIONNAIRE_SENT  temp link to confirm scope + fill gaps
              ├─> DROPPED      (terminal) link expired / not filled
              └─> ENRICHMENT   re-enrich subject from questionnaire answers
                    └─> BROAD_RESEARCH   geo, time, price, economic sense; reuse check
                          └─> FUNNEL     build contact/source list → create Epic + Subtasks
                                └─> OUTREACH   agents contact subject providers (strategy-driven)
                                      └─> REPORT_GENERATION
                                            └─> REPORT_DELIVERED   (terminal) webview to customer
```

Mapping to the original brief:

| Brief step | State(s) | Notes |
|---|---|---|
| 1. Person inquires | `RECEIVED` | items, services, rentals, orgs, goods, trades |
| 2. Pre-research + ethical eval, build questionnaire or deny | `PRE_RESEARCH` → `DENIED`/`QUESTIONNAIRE_SENT` | reuse check starts here |
| 2.1 Questionnaire via temp link, drop if unfilled | `QUESTIONNAIRE_SENT` → `DROPPED` | tokened, expiring link |
| 2.2 Denied dropped | `DENIED` | terminal |
| 2.3 Questionnaire filled | → `ENRICHMENT` | customer confirms item is correct |
| 3. Enrich + broad research | `ENRICHMENT` → `BROAD_RESEARCH` | geo/time/price/economic-sense |
| 4. Inquiry funnel start | `FUNNEL` → `OUTREACH` | Epic + agent Subtasks |
| 4.1 Agent picks up subtask, reaches out | `OUTREACH` | successful inquiry shared back to Epic |
| 5. Report | `REPORT_GENERATION` | timeline + actions + cost options |
| 6. Report shared via webview | `REPORT_DELIVERED` | customer webview |

### Reuse of prior research
Before broad research, the system checks for a prior `subject` + `report` for a
similar item/service within a close geo radius and recent enough time window. If
found, it can shortcut to a derived report (clearly marked as reused, with the
option to refresh). Similarity = embedding match on the enriched subject +
PostGIS distance on the geo point + freshness window.

---

## 2. Domain model

Core aggregates (see `backend/prisma/schema.prisma` for the authoritative DDL):

- **Inquiry** — the customer request. Holds current workflow state + the pinned
  `workflowVersionId` so an in-flight inquiry is never broken by a workflow
  upgrade. One inquiry → one active research lifecycle.
- **Subject** — the enriched, structured description of the thing being sought
  (title, category, attributes, embedding, geo point). Reusable across inquiries.
- **Questionnaire** — generated questions + a tokened, expiring share link;
  stores answers and a `confirmed` flag (customer confirms the subject is right).
- **Epic** — the research campaign for one inquiry. Holds the broad-research
  definition (geo/time/price/economics), the outreach **strategy**, and rolls up
  subtask results.
- **Subtask** — one subject provider/source to reach out to. An agent claims it, finds
  contact details, sends an inquiry, and records the outcome. Owned by one persona
  (`personaId`); carries quality `background` + `qualityScore`.
- **InquiryMessage** — an outbound/inbound message (email v1) tied to a subtask,
  with threading + parsed structured result (price, availability, lead time).
- **Report** — the final synthesized deliverable for the customer (options,
  costs, constraints, timeline of actions).
- **AgentRun / AgentEvent** — execution log of agent activity (start, stop,
  tool calls, errors) for observability and the realtime feed.
- **EventOutbox** — durable event log; the source of truth for realtime fan-out.
- **Finding** — a unit the dynamic report assembles on read (`option`,
  `subject_provider_background`, `constraint`, `note`). See §14.
- **SelfEval** — self-evaluation scores + improvement suggestions feeding the
  self-improvement loop. See §15.

### Versioned workflow tables
- **WorkflowDefinition** — `(key, version, status[draft|active|archived])`.
- **WorkflowState** — states belonging to a definition version.
- **WorkflowTransition** — `(fromState, toState, event, guard, action)`.

A running inquiry references a specific `WorkflowDefinition.id` (a pinned
version). Publishing a new version never mutates existing ones — in-progress
inquiries finish on the version they started on; new inquiries pick the `active`
version. This is the "versioned to avoid in-progress task failure" requirement.

---

## 3. Workflow engine (data-driven + versioned)

The transition logic lives in the database, not in code, so it can be upgraded
dynamically. Code provides a small set of named **guards** and **actions**; the
DB wires states/events to them.

```
advance(inquiry, event, payload):
  def     = load WorkflowDefinition by inquiry.workflowVersionId   # pinned
  trans   = find transition where from = inquiry.state and on = event
  if guard(trans) fails -> reject (stay)
  run action(trans)        # e.g. enqueue 'pre_research' job
  inquiry.state = trans.to
  append EventOutbox(inquiry.id, 'inquiry.transitioned', {from,to,event})
```

- **Guards / actions** are referenced by string name and resolved from a registry
  in `backend/src/workflow/registry`. Adding behavior = add a handler + reference
  it from a new workflow version (a DB migration / seed), never a breaking edit.
- **Events** that drive transitions come from two places: human/API actions
  (e.g. `QUESTIONNAIRE_FILLED`) and agent/job completions (e.g.
  `PRE_RESEARCH_DONE`, `OUTREACH_DONE`). Job completion handlers call
  `advance(...)`.
- The seed in `backend/prisma/seed.ts` installs **v1** of the `inquiry` workflow
  matching section 1.

---

## 4. Agent orchestration

Long-running, retryable work runs as jobs on **pg-boss** (a job queue that uses
Postgres — keeps us to "Postgres only", no Redis). Each pipeline stage is a job
type with its own worker:

`pre_research` · `enrich_subject` · `broad_research` · `build_funnel` ·
`outreach_subtask` · `generate_report`.

Workers are AI-driven via the **Qwen** client (DashScope OpenAI-compatible API).
A worker:
1. claims a job, writes an `AgentRun` (status `running`) + `AgentEvent`s,
2. calls Qwen (+ web/contact tools later) to do its step,
3. persists results, emits an `EventOutbox` row,
4. calls `workflow.advance(...)` with the completion event,
5. marks the `AgentRun` done (or failed → retry/backoff).

### Outreach strategies (Epic-level)
How aggressively to contact subject providers, configured per epic:

- **one_by_one** — send to subject provider 1, wait for reply/timeout, then subject provider 2.
  Cheapest, slowest, least noise.
- **escalating (1:3:9)** — wave 1 = 1 subject provider, wave 2 = 3, wave 3 = 9. Each wave
  fires only if the previous wave hasn't produced enough viable options. Default.
- **parallel** — all subject providers at once. Fastest, noisiest.

A wave coordinator job watches subtask outcomes and releases the next wave (or
stops early once the epic has N qualified options). Successful inquiries are
written back to the epic so later agents can reuse phrasing/contacts that worked
(shared context on the epic record).

### Ethical / feasibility evaluation
`pre_research` runs a structured Qwen check returning
`{ decision: allow|deny, riskTags[], reasoning }`. Deny → `DENIED` with a
customer-facing reason. Categories: illegal goods/services, weapons/controlled
substances, anything harmful or targeting minors, plus feasibility (impossible,
no real market, nonsensical). Denials are logged for audit.

---

## 5. Realtime (live epics / subtasks / results)

Requirement: see epics, subtasks, and results update live on the frontend.

```
worker writes EventOutbox row  ──>  Postgres NOTIFY 'inqi_events'
        │                                   │
        └── (durable, replayable)           ▼
                                   NestJS WsGateway (LISTEN 'inqi_events')
                                            │  Socket.IO rooms:
                                            │   inquiry:<id>  (customer)
                                            │   admin         (all events)
                                            ▼
                                   React clients update in place
```

- **Why outbox + LISTEN/NOTIFY** and not just emit from the worker: durability +
  replay. A reconnecting client (or the admin view) can fetch missed events by
  `EventOutbox.id` cursor, then resume the live stream. NOTIFY is the low-latency
  nudge; the outbox is the truth.
- **WebSockets, not WebRTC.** This is server→client status fan-out (and a little
  client→server for actions). WebSockets via Socket.IO give rooms, reconnection,
  and backpressure for free. WebRTC is for P2P/media/low-latency data channels —
  unnecessary complexity here. (Revisit only if we add live audio/video to
  outreach.)
- **Event envelope** (shared type in `packages/shared`):
  `{ id, type, inquiryId, epicId?, subtaskId?, at, data }`.

---

## 6. Tech stack & rationale

| Concern | Choice | Why |
|---|---|---|
| Backend | **NestJS (TypeScript)** | Fast iteration for agent-orchestration logic; first-class WS gateway, DI, modules; shares language/types with the React app. Rust kept as a future option for CPU-hot paths. |
| DB | **Postgres only** | Relational core + `pgvector` (subject similarity) + PostGIS (geo reuse) + pg-boss (queue) + LISTEN/NOTIFY (realtime). One datastore. |
| ORM/migrations | **Prisma** | Typed client, clean versioned migrations, good seed story. |
| Queue | **pg-boss** | Postgres-backed jobs/retries/scheduling — no Redis, honors "Postgres only". |
| Realtime | **Socket.IO over WebSockets** | Rooms, reconnection, fallback. |
| AI | **Qwen cloud (DashScope, OpenAI-compatible)** | Per brief; wrapped behind `QwenService` with a breadth/depth/balanced **model-tier router** (§10) so the provider and per-stage sizing are swappable. |
| Frontend | **React + Vite + TS**, one app, two views | Customer view + Admin view share components and the WS client. |

### Why NestJS over Rust (the decision you delegated)
The heavy lifting here is orchestration glue: shaping prompts, parsing AI/email
results, wiring jobs and websockets, and iterating on the workflow. That work is
IO-bound and changes constantly — TypeScript + shared types with the frontend
maximize velocity, and NestJS gives structure (modules/DI/gateways) without
boilerplate. Rust's advantages (raw throughput, memory safety) don't bind here
yet; when a specific hot path appears (e.g. high-volume email/result parsing) it
can become a separate Rust service behind the same Postgres/queue. Starting in
Rust would tax every iteration for a payoff we don't need at MVP.

---

## 7. Repository layout

```
inqi/
├─ DESIGN.md                  ← this file
├─ docker-compose.yml         ← Postgres (pgvector/postgis), backend, frontend
├─ pnpm-workspace.yaml
├─ package.json               ← root scripts
├─ .env.example
├─ packages/shared/           ← shared TS types: events, workflow, DTOs
├─ backend/                   ← NestJS
│  ├─ prisma/schema.prisma    ← DB schema (authoritative)
│  ├─ prisma/seed.ts          ← workflow v1 + demo data
│  └─ src/
│     ├─ inquiries/           ← intake, state, REST
│     ├─ questionnaire/       ← tokened link, answers, confirm
│     ├─ subjects/            ← enrichment + reuse lookup
│     ├─ epics/ subtasks/     ← funnel + outreach records
│     ├─ comms/               ← email threading + agent reply loop (§9)
│     ├─ reports/             ← synthesis + webview payload
│     ├─ workflow/            ← engine, registry (guards/actions), versioning
│     ├─ agents/              ← pg-boss workers per stage
│     ├─ events/              ← outbox + LISTEN/NOTIFY + WsGateway
│     └─ ai/                  ← QwenService + model-tier router (§10) + personas (§12)
└─ frontend/                  ← React + Vite
   └─ src/
      ├─ lib/socket.ts        ← WS client + event cursor
      ├─ customer/            ← inquiry status + report webview
      └─ admin/               ← live epics/subtasks/results board
```

---

## 8. Build order (roadmap)

1. **Skeleton (this scaffold):** schema, workflow engine + v1 seed, WS event
   plumbing, REST for intake/questionnaire, stub workers that emit realistic
   events, both frontend views wired to the live feed.
2. **AI substance:** real Qwen prompts for pre-research/ethical eval, enrichment,
   broad research, report synthesis. Structured outputs + validation.
3. **Outreach:** email send/receive via **Postmark** (chosen) + inbound parse webhook, threading,
   result parsing, the wave coordinator for 1:3:9.
4. **Reuse:** pgvector embeddings + PostGIS distance for prior-report reuse.
5. **Hardening:** auth, rate limits, audit, retries/dead-letter, admin controls
   (pause/resume/stop agents), workflow admin UI for publishing new versions.

---

## 9. Agent communication track (email threading)

Each subject-provider **Subtask is one persistent email thread**. Agents don't fire a
single email and guess — they hold a conversation that continues until the
subject provider is qualified, disqualified, or the thread closes.

- **Storage.** Every message (in/out) is an `InquiryMessage` with RFC 5322
  threading: `externalId` (Message-ID), `inReplyTo`, and `references[]` (the full
  chain). `modelTier` records which model drafted an outbound message.
- **Inbound routing.** Each subtask gets a **unique reply address**
  `${token}@INBOUND_DOMAIN` (set as the outbound `Reply-To`). An inbound webhook
  (`POST /api/comms/inbound`) maps the `To` address back to exactly one subtask;
  `Message-ID`/`References` headers are the fallback match. Ingestion is
  idempotent on Message-ID.
- **The reply loop.** Inbound mail is saved + threaded, then a `process_reply`
  job runs the **depth** model over the *full chain* plus **epic memory**
  (`sharedContext` + qualified/failed sibling cases) and decides an intent:
  `continue` (draft + send a follow-up), `qualify` (extract the structured
  result), `disqualify` (close as failed), or `escalate` (hand to a human). On
  `continue` the dialogue keeps going; on `qualify`/`disqualify` the thread
  closes and `CommsService.maybeFinishEpic` fires `OUTREACH_DONE` once enough
  options qualify or all threads close.
- **Shared learning.** Phrasing/contacts that produced a qualified reply are
  written back to `Epic.sharedContext`, so later subtasks draft from what worked.
- **Demo.** `SIMULATE_REPLIES=true` fabricates subject-provider replies so the pipeline
  completes end-to-end without a real email provider wired in.

```
outreach_subtask ──draft(depth)──> send + Reply-To: token@domain
        │                                   │ subject provider replies
        ▼                                   ▼
  status: contacted            POST /api/comms/inbound  (save + thread)
                                            │
                                            ▼
                                process_reply (depth over chain + epic memory)
                                  ├─ continue   → draft follow-up, loop
                                  ├─ qualify    → write result, close
                                  ├─ disqualify → fail, close
                                  └─ escalate   → human
```

Read the full thread for the report timeline / admin via
`GET /api/comms/thread/:subtaskId`.

## 10. Orchestrator model sizing

The orchestrator routes work to a model **tier** by cost vs. capability, via a
small router in `QwenService` (env-configurable):

| Tier | Default model | Used for |
|---|---|---|
| **breadth** | `qwen-turbo` (cheap) | wide funnel: broad research, subject-provider/source discovery, simple/bulk parsing |
| **depth** | `qwen-max` (strong) | per-subject-provider depth research, drafting & replying in email chains (conditioned on epic + successful/failed cases + current chain), verification reasoning, report synthesis |
| **balanced** | `qwen-plus` | default for everything in between (pre-research, enrichment) |

Principle: the **initial breadth search is cheap** because it's high-volume and
low-stakes (cast a wide net). **Depth on a chosen subject provider is expensive** because
it reasons over accumulated context — the epic's shared memory, what has worked or
failed on sibling subject providers, and the live email chain — where quality directly
determines whether an option qualifies.

Stage → tier map:

| Stage | Tier |
|---|---|
| `pre_research` (ethical/feasibility) | balanced |
| `enrich_subject` | balanced |
| `broad_research` (wide options) | **breadth** |
| `build_funnel` (subject-provider discovery) | **breadth** |
| `outreach_subtask` draft + `process_reply` | **depth** |
| reply verification / qualification | **depth** |
| `generate_report` synthesis | **depth** |

Env: `QWEN_MODEL_BREADTH`, `QWEN_MODEL_DEPTH`, `QWEN_MODEL` (balanced). Swap a
tier's model in one place without touching stage code.

## 11. Orchestrator & agents (two roles, one backend)

inqi's backend plays two roles. **Do they need separate applications? No — not for
the MVP.** They are worker roles in the *same* NestJS backend, separated as
pg-boss worker pools over the shared Postgres. Because they only ever communicate
through the database and the queue, either role can later be peeled off into its
own deployable (same DB, same queue) without a rewrite — a deployment choice, not
an architecture change.

**Orchestrator** — manages task *completion and retry* and the *flow*. Triggered
by **epic creation** and **subtask completion/failure**. Responsibilities:

- Drive the workflow engine (`advance`) on job completion events.
- **Retries / backoff** — pg-boss retry policy per job type; failed subtasks are
  retried, then dead-lettered and surfaced as `agent.failed`.
- **Priority** — every Epic has `priority` (1 highest … 9 lowest). Outreach jobs
  are enqueued with pg-boss `priority = 10 - epic.priority`, so high-priority
  inquiries jump the queue.
- **Rate limiting** — global and per-tier concurrency caps on workers
  (pg-boss `teamSize`/`teamConcurrency`), plus a per-email-domain send throttle so
  outreach stays polite and within provider limits. This is the single lever to
  throttle the whole execution flow.

**Agent** — does the actual research and *carries the conversation*. Triggered by
**subtask creation** and **inbound email** from a subject provider. Responsibilities:
claim a subtask, research the subject provider, draft/send outreach in a fixed
persona, and run the reply loop (§9) until qualified/closed.

```
Orchestrator  ── reacts to ──>  epic.created, subtask.completed/failed
              ── controls ──>   retries, priority order, rate limits, workflow transitions
Agent         ── reacts to ──>  subtask.created, inbound email
              ── does ──>       subject-provider research, persona outreach, reply loop
```

## 12. Agent personas

Outreach must not read as templated, a subject provider must always hear back from
the *same person*, **and it should come from a plausible local of a regional proxy
hub**. So agents wear one of **eight hub personas** (`backend/src/ai/personas.ts`),
routed by the subject provider's region:

| Persona | Proxy hub | Serves (subject-provider region) |
|---|---|---|
| **Yuen** | Hong Kong | Greater China / East Asia |
| **Ari** | Singapore | South & Southeast Asia |
| **Ellis** | London | UK / Western Europe (default) |
| **Bo** | Amsterdam | Netherlands / Central Europe (Prague, Berlin, Warsaw) |
| **Nour** | Dubai (UAE) | Middle East / Gulf |
| **Tumi** | Johannesburg | South Africa / Sub-Saharan Africa |
| **Marlowe** | New York (USA) | North America |
| **Sol** | São Paulo (Brazil) | South America / LATAM |

- **Region-aware routing.** `pickPersona(regionHint)` matches the subject
  provider's country/region (from `Subtask.contact`) to its hub persona; an unknown
  region falls back to the English hub (London / Ellis). Matching is token-exact so
  short country codes never false-match (e.g. "Berlin" never routes to India).
- **Names are gender-neutral and locale-appropriate to the hub** (Yuen=HK,
  Nour=Gulf, Tumi=South Africa, Bo=NL…), so the contact reads as a trusted local
  rather than a generic sender.
- **Distinct writing voices** anchored to **21st-century literature of each
  region** — the differentiator that keeps emails from sounding templated.
- **Shared framing** — every persona is an inquiry specialist at *"Inqi Tech
  Service Provider"*, working from its hub, honest about who they are.
- **Thread continuity** — once assigned (stored as `Subtask.personaId`) **the same
  persona replies for the life of the email chain**. The persona's voice + hub is
  injected into the depth model via `personaSystem(persona, task)`.

## 13. Compliance scoring (ethical + legal gate)

Separate from the one-time pre-research ethical evaluation (§4), **every outbound
email and every questionnaire passes an ethical + legal scoring gate before it
leaves inqi**, so a customer is never shown anything illegal or unsafe.

- A scorer returns `{ score 0..1, tags[] }`; messages/questionnaires carry
  `reviewStatus (pending|passed|blocked)` and `riskScore`.
- `blocked` outbound email → the subtask is closed `failed`, nothing is sent.
- `blocked` questionnaire → it is not shared; the inquiry can be re-denied.
- All scores are stored for audit. (v1 is a stub returning `passed`; replace with
  a real Qwen rubric — `scoreCompliance` in `CommsService`.)

## 14. Report: subject-provider background + dynamic assembly

Two upgrades to the report:

**Subject-provider background (quality, not just price).** Before an option is
recommended, the agent researches the subject provider's **eligibility** —
ratings, reviews/feedback, track record — stored on `Subtask.background` +
`qualityScore` and as a `Finding` of kind `subject_provider_background`. The
report shows this alongside price so we never recommend a cheap but low-quality
service. Options can be ranked by a blend of price and `qualityScore`.

**Dynamic report.** The report is **assembled from a findings store**, not written
once at the end. The Epic defines the subject of research; as each agent
consolidates its work + conversation it appends `Finding` rows (`option`,
`subject_provider_background`, `constraint`, `note`). The customer webview reads
findings live (so the report fills in as research progresses); the `Report` row is
the finalized snapshot at `REPORT_DELIVERED`.

## 15. Self-evaluation & dynamic workflow improvement

The workflow is data-driven and **versioned** precisely so inqi can improve itself
incrementally. After a run, a self-evaluation scores the result (coverage,
quality, latency, cost) into a `SelfEval` row and proposes improvements — e.g.
"add a subject-provider background-research stage." Because workflows are versioned
(§3), an improvement ships as a **new `WorkflowDefinition` version**: in-flight
inquiries finish on their pinned version, new ones pick up the improved flow. So a
capability that doesn't exist in v1 (like background research) can be added in v2
without disrupting running work — continuous, safe, AI-assisted improvement.

## 16. Open questions / decisions to revisit

- **Email provider:** Postmark (chosen — simplest send + native inbound parse webhook that maps to `POST /api/comms/inbound`).
- **AuthN/Z**: customer magic-link vs account; admin SSO.
- **Embeddings**: Qwen embeddings vs local model for subject similarity.
- **Reuse policy**: geo radius + freshness window thresholds (configurable).
- **Human-in-the-loop**: optional approval gate before outreach for high-risk or
  high-cost campaigns.
- **PII/compliance**: storage and retention for subject-provider/customer contact data.

# inqi

[![CI](https://github.com/andrew-vogulkin/inqi/actions/workflows/ci.yml/badge.svg)](https://github.com/andrew-vogulkin/inqi/actions/workflows/ci.yml)

**AI-driven research & inquiry workflow.** A customer describes what they're after —
an item, service, rental, organisation, goods or a trade. AI agents vet the request,
confirm scope with a short questionnaire, discover candidate providers (**breadth**),
research each one across channels (**depth**), reach out by email, and assemble a
**live, ranked cost-&-constraints report** the customer watches build in real time.

> **Accuracy over aspiration:** this README is generated from the real repo (the
> `backend/src` module tree, `prisma/schema.prisma`, `config.service.ts`, the seeded
> workflow). Architecture rationale lives in **[DESIGN.md](DESIGN.md)**; per-feature
> handovers live in the [Notion space](https://app.notion.com/p/38dab80b77f281518161cd9333bc2fbf).

---

## Architecture & deployment (Alibaba Cloud + Qwen Cloud)

![Infrastructure](docs/hackathon/inqi-architecture-infra.png)

![Main flow](docs/hackathon/inqi-architecture-flow.png)

The whole product runs on **one Alibaba Cloud ECS instance** (Docker Compose,
Caddy TLS, on-box Postgres — see [`deploy/`](deploy/) for the production compose
file, Caddyfile and runbook), and **every model call goes to Qwen Cloud
(DashScope)**: the OpenAI-compatible client lives in
[`backend/src/infra/ai/qwen-provider.base.ts`](backend/src/infra/ai/qwen-provider.base.ts),
wired to `https://dashscope-intl.aliyuncs.com` in
[`backend/src/infra/config/config.service.ts`](backend/src/infra/config/config.service.ts)
(`DASHSCOPE_BASE_URL`, line 13) with per-phase model tiers (breadth / depth /
balanced). Try it live: **https://inqi.monkeycode.io** — sign up and the system
grants 10 credits automatically.

---

## Data model — entities & lifecycles

The core hierarchy is a research **matrix**:

```
Customer 1─M Report ("Bangkok best bars")          ← the root request; one persona; one workflow run
              │ 1─1 Subject                        ← the enriched "what they want" (reusable via pgvector/PostGIS)
              │ 1─1 Questionnaire                  ← scope confirmation (capability-token link)
              │ 1─1 ReportSnapshot                 ← the final deliverable (token link, freemium gating)
              │ 1─M Epic                           ← outreach campaign internals (waves, shared context)
              └ 1─M Inquiry ("G.O.D Bkk")          ← one candidate under investigation (max 8 per report)
                     └ 1─M Source                  ← one typed channel record (max 5 per inquiry, ≥1 email)
                            └ 1─M Message          ← the email thread (on thread-type sources)
```

### Report — the root aggregate

One customer request end-to-end: `rawRequest`, geo/budget/deadline, credit gating, and
`personaId` — one of **8 code-defined personas** (region-matched at creation) that
carries *every* interaction of this report with one voice.

> **Persona fleet pin (temporary):** while the outbound sender identity is under
> email-provider (Postmark) approval, every new report is pinned to **Marlowe** via
> the hardcoded `FORCED_PERSONA_ID` constant in
> `backend/src/domain/agent/personas.ts`. Set it back to `null` to restore
> region-aware routing across all 8 personas. Existing reports keep the persona
> they were created with either way.

**Lifecycle** = the versioned workflow (`ReportState`, stored in the DB, pinned per report):

```
RECEIVED ─START_PRE_RESEARCH→ PRE_RESEARCH ─passed→ QUESTIONNAIRE_SENT ─filled→ ENRICHMENT
   → BROAD_RESEARCH ─(reuse found→ REPORT_DELIVERED)─ else → FUNNEL → OUTREACH
   → REPORT_GENERATION → REPORT_DELIVERED ✓

PRE_RESEARCH ─denied→ DENIED ✗          QUESTIONNAIRE_SENT ─expired→ DROPPED ✗
any processing state ─stage failed (after retries/reaper)→ FAILED ✗
any non-terminal ─operator CANCEL→ CANCELLED ✗     OUTREACH ⇄ ON_HOLD (operator pause/resume)
```

Terminal: `REPORT_DELIVERED`, `DENIED`, `DROPPED`, `FAILED`, `CANCELLED`.
**Pay-on-delivery**: submit only checks the balance covers the cost (402 if short
and the free slot is spent); the 1-credit **charge lands on `REPORT_DELIVERED`**
— every other outcome costs nothing (idempotent — unique `(reportId, kind)`
ledger key; a legacy pre-pay-on-delivery hold is still refunded).

### Inquiry — one candidate under investigation

Created by **breadth discovery** (funnel build / widening), capped at
`BREADTH_MAX_INQUIRIES` (default **8**) per report. Carries `name`, `leadSource`
(`ai | fallback`), discovered `contact`, its `wave` (1:3:9 escalation), a research
`background` digest and the 0..1 `qualityScore` used for ranking.

`researchPending` (default `true`) marks that the inquiry's depth-research job is
still queued/running — it is cleared when the verdict persists. The admin board
shows a *researching* chip while it's set, the customer dossier shows an
in-progress note instead of "no web sources", and **report synthesis defers**
until every non-failed/skipped inquiry has cleared it (bounded: 90 polls × 20 s,
then it proceeds anyway so a dead job can't strand the report). If a verdict
still lands *after* delivery (deadline hit, or a re-run), `refresh_snapshot` is
enqueued: the snapshot's options are **re-ranked and the summary re-synthesized
in place** (token/freemium/unlocked untouched, `snapshot.updated` emitted) — the
frozen summary can never contradict the live re-ranked list.

**Lifecycle** (`InquiryStatus`; the agent is the sole writer):

```
pending ─wave released→ researching ─outreach email sent→ contacted ─reply→ replied
  replied ─reply-parse: qualify→ qualified ✓ (Option finding appended → report ranks it)
  replied ─reply-parse: continue→ contacted (follow-up sent, loop)
  replied / contacted ─disqualify | bounce | compliance block→ failed ✗
  contacted ─silent past REPLY_TIMEOUT_MINUTES→ unresponsive ◌ (NOT failed: the thread
    stays open (long-poll email) and the report stops waiting; a reply landing ANY time
    later runs the normal reply loop — and re-evaluates a delivered report in place)
  pending ─epic stopped early (target met)→ skipped ✗ (released-never; distinct from failed)
```

Every settlement (`qualified`/`failed`) enqueues the **reactor** (`inquiry_settled`),
which decides: wait / release next wave / widen discovery / finish outreach.

### Source — one typed channel record (the matrix cell)

Everything an inquiry knows arrives as a `Source` row, typed by `SourceType`:

| Type | Kind | What it is | Created by |
|---|---|---|---|
| `websearch` | flat | a real web page found for the candidate (url + title + snippet) | breadth evidence + depth search |
| `rating_feedback` | flat | ratings/reviews digest (rating, count, themes in `data`) | depth research |
| `email` | thread | the conversation anchor: unique `replyAddress`, `convState`, owns the Messages | first outreach send |
| `whatsapp` | thread | reserved (enum only) | — |

**Budget:** max `SOURCES_MAX_PER_INQUIRY` (default **5**) per inquiry, with **≥1 slot
always reserved for the email thread** — so flat sources cap at 4; email sources
themselves are *not* capped (a second thread is allowed). Flat sources are upserted on
`(inquiryId, type, url)` — re-finding a page never duplicates it.

**Thread lifecycle** (`convState`, on the email source):
`idle → awaiting_reply → needs_action (inbound arrived) → awaiting_reply (follow-up) → closed (settled)`.
`lastInboundAt` updates on every ingest; the reply address maps an inbound webhook hit
back to exactly one inquiry.

### Message — the thread itself

Belongs to a thread Source (+ denormalized `inquiryId`). Direction
`outbound | inbound`, status `draft → sent → delivered / received / bounced`, RFC 5322
threading (`externalId`/`inReplyTo`/`references`), the parsed offer (`price`,
`availability`), and a per-message **compliance gate** (`reviewStatus`, `riskScore`,
`riskTags`) — blocked drafts are persisted (auditable) but never sent.

### ReportSnapshot — the deliverable

Written once at `REPORT_GENERATION` (or derived from a prior report on reuse): the
ranked `options` JSON, AI-synthesized `summary`, `timeline`, and a **capability
`token`** for the shareable deep link (`/#/s/<token>`).

**Freemium lifecycle (HP-21):** a customer's first report is free → snapshot is
`freemium: true, unlocked: false` — options are redacted to locked stubs except the
#5-ranked taster. `POST /api/snapshots/:id/unlock` charges 1 credit (race-safe,
idempotent) → `unlocked: true`, full reveal, `snapshot.updated` event.

### Epic — outreach campaign internals

Orchestration grouping under a report: `strategy` (`escalating` 1:3:9 | `one_by_one` |
`parallel`), `targetQualifiedOptions` (pursues **Ready ≥ 5**), `releasedWaves[]`
(idempotent wave release), `sharedContext` reused across sibling threads.
Lifecycle: `open → done` (target met / funnel dry) or `stopped`.

### Subject & Questionnaire — scope

- **Subject** (1:1): the enriched description (`title`, `category`, `attributes`), plus
  pgvector embedding + PostGIS point (added by `init.sql`) powering **prior-report
  reuse** (cosine ≥ threshold + radius + freshness → short-circuit to delivery).
- **Questionnaire** (1:1): capability-token link the customer fills; `reviewStatus`
  compliance gate (`pending → passed | blocked`), `confirmed` flips on submit
  (→ `QUESTIONNAIRE_FILLED`), `expiresAt` TTL (default 72h) drops the report
  (→ `DROPPED`) with a reminder email `REMINDER_LEAD_HOURS` before.
  Questions are generated by an expert-framed research agent (~5 web searches,
  7–10 questions): a **mix of `select`** (pick one — budget band, timing) **and
  `multiselect`** (pick any — features, must-haves), each 3–4 concrete options
  **plus an always-appended "Decide for me"** fallback that delegates that
  dimension to the agent. Multi answers submit comma-joined.

### Supporting entities

| Entity | Role / lifecycle |
|---|---|
| `WorkflowDefinition/State/Transition` | The state machine **in the DB**, versioned (`draft → active → archived`). Seed installs v1 (archived, 11 states) + v2 (active, 14 states / 28 transitions). Reports pin a version forever; publishing a new version never breaks in-flight runs. |
| `Customer` | Google-sign-in identity. `role` (`customer`/`admin`) is **DB-owned** — admins are marked manually (`db:promote-admin`). Holds the credit balance + the one-free-report flag. |
| `CreditLedger` | Append-only, pay-on-delivery: `topup → charge (on REPORT_DELIVERED)`, plus `unlock` (freemium reveal); legacy runs may still carry `reserve`+`refund` pairs. Balance = Σtopup + Σrefund − Σreserve − Σunlock − Σ(delivery charge). |
| `Finding` | Dynamic-report store: agents append `option` / `subject_provider_background` / `constraint` / `note`; the report is **assembled on read** (live view and snapshot use the same ranking) — that's why the report is "alive". |
| `AgentRun` / `AgentEvent` | Execution log per pipeline stage: `running → done / failed / stopped / cancelled`, with lease + heartbeat — a stage that stops heartbeating is recovered by the **reaper** (retry with backoff, or fail-transition after `STAGE_MAX_ATTEMPTS`). |
| `EventOutbox` | Durable realtime log (BigInt cursor). Insert → Postgres `NOTIFY` → Socket.IO fan-out to `report:{id}` + `admin` rooms, with cursor replay on reconnect. |
| `UsageRecord` | Append-only cost ledger: every AI call (tokens/model/tier) + counted actions (emails, replies, discovery, research, embeddings) → the admin `GET /reports/:id/cost` rollup. |
| `AuditLog` | Operator/system actions (cancel/pause/resume/publish/topup/unlock) targeting a report, workflow or customer — feeds the `GET /audit` trail. |
| `SelfEval` | Self-improvement scaffold: scored runs + proposed workflow versions. |

### Agent context (100k budget)

Everything a report knows — all inquiries, their sources, their threads — is packed
into model context by `buildAgentContext` under a **100k-token budget**: header
(request/subject/confirmed scope) always; one compact line per inquiry, best-first;
then detail rounds **round-robin** across inquiries (latest emails → rating snippets →
web snippets → older mail) so one long thread can't starve the rest. Consumers:
report synthesis (100k), the reply loop (50k, focused on the current inquiry).

---

## The process, start to end

Every agent step is a **pg-boss queue task** (Postgres-backed, one job per worker,
at-least-once with idempotency guards). The full run:

```
 0. POST /auth/email (+ /verify)         two-step sign-in: email, then the MFA code
                                         (transport mocked — code 123456)
 1. POST /api/reports                    one tx: balance check (free-slot fallback) + Report row — nothing charged yet
                                         (persona assigned by geo) + report.created → commit
                                         → workflow event START_PRE_RESEARCH
 2. [queue] pre_research                 DEPTH feasibility + ethics gate → deny (DENIED, refund)
                                         or create Subject + Questionnaire → QUESTIONNAIRE_SENT
 3. [queue] send_questionnaire           email the capability link; reminder before expiry
    — customer confirms scope →         QUESTIONNAIRE_FILLED
 4. [queue] enrich_subject               BALANCED re-enrichment from the answers
 5. [queue] broad_research               BREADTH scope pass; prior-report reuse lookup
                                         (pgvector + PostGIS) → REUSE_FOUND short-circuits
                                         to a derived snapshot + REPORT_DELIVERED
 6. [queue] build_funnel                 BREADTH-SEARCH LIFECYCLE (diagram below): model-formed
                                         queries → multi-search → relevance-gated mining →
                                         qualification filter → conversion-driven fallback →
                                         up to 8 Inquiries created, each with its evidence
                                         pages as websearch Sources, waves assigned (1:3:9)
                                         — and one DEPTH task enqueued each
 7. [queue] research_background × N      DEPTH per inquiry: ~5 targeted queries → lead pool →
                                         agentic tool loop (web_search+open_url) → evaluation
                                         gate → targeted refine cycles → verdict SETTLES the
                                         inquiry; cited pages → websearch Sources (≤4 flat incl.
                                         the rating digest, 1 slot reserved for email),
                                         background + qualityScore, SubjectProviderBackground
                                         finding, source.added events
 8. [queue] start_outreach               release wave 1
 9. [queue] outreach_inquiry × wave      per inquiry: ensure the email-thread Source (unique
                                         reply address), persona-voiced draft, compliance gate
                                         (blocked → failed, draft kept for audit), send,
                                         Message + message.sent — idempotent on retry
10. POST /api/comms/inbound              provider replies (Postmark webhook, or the local
                                         provider's simulated loopback) → reply address →
                                         thread Source → Message + message.received
11. [queue] process_reply                DEPTH reply parse over the chain + focused 50k report
                                         context → continue (follow-up) | qualify (Option
                                         finding + result) | disqualify → thread closed
12. [queue] inquiry_settled (reactor)    after each settlement: reached target (5)? → finish;
                                         wave in flight? → wait; else release next wave; funnel
                                         dry? → widen discovery (still capped at 8 total)
13. [queue] generate_report              **depth-research gate**: defer (re-enqueue, 20 s)
                                         while any non-failed inquiry has researchPending —
                                         options never ship with empty dossiers (max 30 min,
                                         then proceed) → assemble findings → rank
                                         (quality+price) → DEPTH
                                         synthesis over the 100k report context → ReportSnapshot
                                         (freemium-locked if the free report) → snapshot.ready
                                         → REPORT_DELIVERED → credits charged → notification
14. GET /#/s/<token>                     shareable snapshot; freemium unlock charges 1 credit
```

Watching it live: the frontend joins `report:{id}` (customer) / `admin` rooms; every
step above emits typed events (`report.transitioned`, `inquiry.created/updated`,
`source.added`, `message.sent/received`, `wave.released`, `funnel.widened`,
`snapshot.ready/updated`, `credits.*`, `agent.*`) that drive the dashboard, live
report, admin board and inquiry views without polling.

**Resilience:** stages run under a lease + heartbeat; the reaper recovers stuck runs
(retry w/ backoff or per-stage failure event → `FAILED`). Operator `pause` holds new
waves (`ON_HOLD`), `resume` continues, `cancel` lands `CANCELLED` — all audited.

### Breadth-search lifecycle (step 6, `build_funnel` + widening)

```
┌─ A. CONTEXT ────────────────────────────────────────────────────────────┐
│ Model receives the full scope: subject title + description + confirmed │
│ questionnaire answers (budget, timing, format) + names to exclude      │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼
┌─ B. QUERY FORMATION ────────────────────────────────────────────────────┐
│ Model forms 5 diverse, service-first queries                            │
│ ("rooftop yoga class Bangkok", "yoga studio rooftop Sukhumvit", …)      │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼
┌─ C. SEARCH ─────────────────────────────────────────────────────────────┐
│ All 5 run against SearXNG → hits merged + deduped into one pool (≤24)   │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼
┌─ D. MINE + E. QUALIFY ──────────────────────────────────────────────────┐
│ Relevance-gated mining (must PROVIDE the subject, evidence urls only)   │
│ → qualification filter drops look-alikes (bars ≠ yoga studios)         │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼
        ✓ ADAPTIVE CHECKPOINT: full target met? → G. DONE
          2 dry rounds (no new finds) / same queries / cap 50 → G (partial)
               │ otherwise ▼
┌─ F. FALLBACK ROUND (adaptive, ≤ BREADTH_MAX_CYCLES = 50) ───────────────┐
│ Model is told: "N of M converted. Relax the LEAST-essential constraint  │
│ and form 5 broader queries." Rules:                                     │
│   • drop one qualifier per round ("rooftop yoga studio"→"yoga studio")  │
│   • NEVER drop the service itself or the location                       │
│   • must return relaxed: "rooftop" — the constraint it gave up          │
│ → back to C with the broader queries; new candidates carry              │
│   matchNote: "found without 'rooftop' — confirm via research/outreach"  │
└─────────────────────────────────────────────────────────────────────────┘
               ▼
┌─ G. OUTPUT ─────────────────────────────────────────────────────────────┐
│ Full-match candidates first, fallback candidates after, each with       │
│ evidence + matchNote. "relaxed X" logged into Agent activity; the       │
│ depth agent VERIFIES the relaxed dimension (unconfirmedConstraint in    │
│ its prompt) and reflects it in eligibility.                             │
└─────────────────────────────────────────────────────────────────────────┘
```

The loop **self-adjusts**: it presses toward the full funnel target while rounds
still produce new qualified candidates, and stops the moment they don't (2 dry
rounds, unchanged queries) — the 50-cycle cap only bounds a genuinely productive
run. Conversion is measured **after** the qualification filter — found pages mean
nothing if nothing survives relevance. The relaxed constraint never vanishes:
it travels on the inquiry (`contact.matchNote`) into depth research and outreach,
so a fallback find only ranks as a full answer once the missing dimension is
confirmed. Every step degrades gracefully (search down → AI-only proposal,
filter/fallback failure → fail-open/stop, AI unconfigured → deterministic names).

### Depth-research lifecycle (step 7, `research_background` per inquiry)

```
┌─ A. CONTEXT ────────────────────────────────────────────────────────────┐
│ ONE candidate: name + region + what the customer is looking for +       │
│ unconfirmedConstraint (when breadth found it via a fallback round)      │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼
┌─ B. QUERY FORMATION ────────────────────────────────────────────────────┐
│ Model forms ~5 targeted queries, one per angle:                         │
│ official site/booking · reviews & ratings · pricing per the request's   │
│ unit · complaints/closure/red flags · the unconfirmed constraint        │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼
┌─ C. SEARCH ─────────────────────────────────────────────────────────────┐
│ All queries run against SearXNG → hits merged + deduped into one lead   │
│ pool (≤12) that SEEDS the agent's first cycle                           │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼
┌─ D. AGENTIC STRENGTHENING (tool budget per cycle) ──────────────────────┐
│ web_search + open_url (real browser). The agent STRENGTHENS breadth's   │
│ knownFacts (website/socials/price mentions): opens the official site    │
│ FIRST, then a review page, and only searches for what pages didn't      │
│ answer. Verdict: eligible | not eligible (EVIDENCE OF ABSENCE only) |   │
│ unverified (lack of evidence is never a disqualification)               │
└──────────────┬──────────────────────────────────────────────────────────┘
               ▼
        ✓ E. EVALUATION GATE (cheap audit of the verdict):
          eligibility grounded in a cited page? constraint verified?
          rating/price evidenced or genuinely unavailable? red flags
          actively looked for?
               │ sufficient / STALLED (same gaps twice — the evidence
               │ isn't out there) / cap reached → G. DONE
               │ insufficient with NEW gaps ▼
┌─ F. TARGETED REFINE CYCLE (adaptive, ≤ DEPTH_AGENT_CYCLES = 150) ───────┐
│ Fresh tool budget aimed at the gate's NAMED gaps first                  │
│ ("price not evidenced — open the booking page"), then generic           │
│ hardening: cross-check ratings on an uncited source, hunt red flags,    │
│ drop what pages no longer support → back to E                           │
└─────────────────────────────────────────────────────────────────────────┘
               ▼
┌─ G. VERDICT ────────────────────────────────────────────────────────────┐
│ Cited pages persist as websearch Sources (customer-visible proof);      │
│ the verdict SETTLES the inquiry (eligible+score → qualified with a      │
│ web-evidenced price; ineligible → failed with the reason) — email       │
│ replies only ENRICH it later, never gate it.                            │
└─────────────────────────────────────────────────────────────────────────┘
```

The gate replaces the old always-refine loop and makes cycles **demand-driven**:
sufficient evidence stops after cycle 1 (cheaper), insufficient evidence buys
another cycle aimed at the exact shortfalls — but only while the gaps keep
CHANGING. The same gaps twice in a row means the evidence isn't publicly out
there (e.g. a genuinely unpublished price) and the loop ships the verdict
instead of burning the 150-cycle cap. Degrades gracefully: query formation
fails → naive "name + region" search; search down → empty pool (the agent
searches itself); gate fails → treated as sufficient (a broken auditor never
burns cycles); agent fails with a prior verdict in hand → the prior verdict
stands; AI unconfigured → deterministic fallback scoring.

> Per-entity deep-dives (Report / Inquiry / Source lifecycles, plus these two
> search lifecycles with their dependencies) live in [`docs/`](docs/README.md).

---

## Stack & hard constraints

- **Backend** — NestJS 10 (modular DI), Prisma 5.
- **One datastore: Postgres.** Data **+** `pgvector` (subject similarity) **+** PostGIS
  (geo) **+** `pg-boss` job queue **+** `LISTEN/NOTIFY`. No Redis, no Kafka.
- **Realtime** — `EventOutbox` → Postgres `NOTIFY` → Socket.IO gateway (with cursor replay).
- **Frontend** — React 18 + Vite (no backend logic; pure view over events/DTOs).
- **AI** — Qwen (DashScope cloud *or* a local endpoint), behind a provider seam;
  **degrades gracefully with no key** for keyless demos.
- **Web search** — self-hosted SearXNG behind the `WEB_SEARCH` seam (breadth discovery +
  depth research + agent tools); unreachable search never blocks the pipeline.
- **Shared types** — `packages/shared` (events, workflow, enums, DTOs) used by both ends.

## As-built structure

Monorepo (pnpm workspaces: `backend`, `frontend`, `packages/*`). The backend is split
into three tiers — **`edge/`** (ingress), **`domain/`** (business logic), **`infra/`**
(cross-cutting):

```
backend/src
├─ edge/                     # ingress — HTTP controllers + DTOs + guards
│  ├─ public/                #   live report read
│  ├─ capability-token/      #   questionnaire + snapshot via opaque token
│  ├─ auth/                  #   Google sign-in, sessions, owner/admin-scoped reports,
│  │                         #   snapshot unlock, workflow admin, audit, cost, comms thread
│  └─ webhooks/              #   inbound provider email (signed)
├─ domain/                   # business logic (one module per capability)
│  ├─ report/                #   the root aggregate: intake, lifecycle, 100k agent context
│  ├─ questionnaire/         #   scope confirmation
│  ├─ compliance/            #   request/message vetting  (COMPLIANCE_SCORER seam)
│  ├─ subjects/              #   subject identity + prior-report reuse (pgvector/PostGIS)
│  ├─ subject-providers/     #   breadth discovery + depth background research
│  ├─ orchestrator/          #   versioned workflow engine, stage workers, waves/reactor,
│  │                         #   pause/resume/cancel, reaper, workflow-version admin
│  ├─ agent/                 #   the 8 personas + the reply loop (sole Inquiry-status writer)
│  ├─ source/                #   the Source layer: flat sources + the email channel (MAIL seam)
│  ├─ snapshot/              #   assembly + ranking + synthesis + freemium unlock + provenance
│  ├─ notifications/         #   customer emails + reminders (NOTIFICATION_CHANNEL seam)
│  ├─ customer/ credits/     #   accounts + the credit ledger
│  ├─ kanban/ eval/          #   board projection · self-eval scaffold
├─ infra/                    # cross-cutting
│  ├─ config/                #   typed env access (the only place process.env is read)
│  ├─ persistence/ queue/    #   Prisma (DbTx convention) · pg-boss
│  ├─ events/                #   EventOutbox + LISTEN/NOTIFY + Socket.IO gateway
│  ├─ ai/                    #   Qwen providers + prompts.ts (ALL system prompts) + embeddings
│  ├─ websearch/             #   WEB_SEARCH seam: SearXNG provider + AI tool definitions
│  ├─ observability/ usage/  #   health, audit, reaper logic · token/action cost ledger
└─ common/                   # error envelope (typed { error }) + logging interceptor
```

```
frontend/src
├─ App.tsx                   # hash router + auth-aware nav
├─ screens/                  # Dashboard, NewReport, LiveReport, FreemiumTeaser, Dossier,
│                            # Questionnaire, AdminBoard, InquiryView (source matrix),
│                            # OutreachThread, RunControls, CostReport, AuditTrail, Workflows
├─ state/                    # reducer store (reports, report, adminBoard, inquiry, …)
├─ realtime/                 # socket + envelope (rooms, cursor replay)
├─ api/                      # typed client + endpoint builders (from shared Paths)
├─ conventions/              # routes, guards, ranking, stages, dossier/thread view models
└─ ui/ theme/ shell/         # design system + layouts
```

## Run it locally

Prereqs: Node 22, pnpm 9, Docker.

```bash
# 1. Postgres with pgvector + PostGIS (image built from db/)
docker compose up -d db

# 2. Install + build everything
pnpm install
pnpm -r build

# 3. Schema → extensions/trigger → seed (workflow v1/v2 + demo data)
#    Prisma auto-reads .env for DATABASE_URL; copy the example first.
cp .env.example .env
pnpm --filter @inqi/backend exec prisma db push
docker compose exec -T db psql -U inqi -d inqi -v ON_ERROR_STOP=1 < backend/prisma/sql/init.sql
pnpm --filter @inqi/backend exec prisma db seed

# 4a. Run — KEYLESS demo (no API keys; auto-generated provider replies drive outreach)
DATABASE_URL='postgresql://inqi:inqi@localhost:5432/inqi?schema=public' \
  SIMULATE_REPLIES=true AUTH_VERIFIER=stub \
  node backend/dist/main.js                       # backend on :4000 — Swagger at /api/docs

# 4b. …or run with your configured providers (the backend reads process.env, not .env):
node --env-file=.env backend/dist/main.js

# 5. Frontend (separate shell)
pnpm --filter @inqi/frontend dev                  # Vite on :5173 (proxies /api + /socket.io → :4000)
```

Verify: open `http://localhost:5173`, submit a request, watch the report assemble live.
API reference (every endpoint + DTO): **`http://localhost:4000/api/docs`** (Swagger).
Tests: `pnpm -r test` (unit) · `pnpm --filter @inqi/frontend test:e2e` (Playwright).
CI runs the same DB → push → `init.sql` → seed → build → test sequence hermetically
(see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Environment configuration

All env is read in **one place** (`backend/src/infra/config/config.service.ts`).
Swappable seams pick a driver by env; **omit the credential and the demo still runs.**

### Core

| Env | Default | What it does |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres: data + queue + realtime |
| `PORT` | `4000` | backend HTTP port |
| `WEB_ORIGIN` | local dev + prod origin | CORS allowlist (comma list or `*`) |
| `PUBLIC_BASE_URL` / `WEB_BASE_URL` | `http://localhost:4000` / `:5173` | absolute links in emails |
| `SESSION_SECRET` / `SESSION_TTL_HOURS` | `change-me` / `24` | HMAC session signing + TTL |

### AI & search

| Env | Default | What it does |
|---|---|---|
| `AI_DRIVER` | `qwen_cloud` | `qwen_cloud` (Qwen Cloud / DashScope) \| `qwen_local` (own endpoint). No key → graceful stub fallback |
| `QWEN_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL{,_BREADTH,_DEPTH}` | DashScope / `qwen3.6-plus` | per-phase model routing: BREADTH = cheap/wide discovery, DEPTH = strong (deep research, reply loop, synthesis) |
| `QWEN_LOCAL_{BASE_URL,API_KEY,MODEL,MODEL_BREADTH,MODEL_DEPTH}` | alias `qwen` | local OpenAI-compatible endpoint |
| `EMBEDDINGS_DRIVER` + `EMBEDDINGS_{API_KEY,BASE_URL,MODEL,DIM}` | local hash, `DIM=1024` | subject vectors for prior-report reuse |
| `WEBSEARCH_DRIVER` | `searxng` | `serper` (hosted Google SERP) \| `searxng` (self-hosted) — one vendor seam |
| `SERPER_API_KEY` / `SERPER_BASE_URL` / `SERPER_TIMEOUT_MS` | — / google.serper.dev / `10000` | Serper credentials (serper driver only) |
| `WEBSEARCH_BASE_URL` / `WEBSEARCH_TIMEOUT_MS` / `WEBSEARCH_MAX_RESULTS` | instance URL / `10000` / `8` | SearXNG connection profile |

### Research limits (the matrix)

| Env | Default | What it does |
|---|---|---|
| `BREADTH_MAX_INQUIRIES` | `8` | max Inquiries (candidates) per Report — a hard funnel cap; widening never exceeds it |
| `SOURCES_MAX_PER_INQUIRY` | `5` | max Sources per Inquiry; **1 slot always reserved for the email thread** (so ≤4 flat web/rating rows; email itself uncapped) |

### Outreach & comms

| Env | Default | What it does |
|---|---|---|
| `MAIL_DRIVER` | `local` | `local` (writes `.mail-outbox/`, loops back) \| `postmark` |
| `POSTMARK_SERVER_TOKEN` / `POSTMARK_FROM` / `LOCAL_MAIL_DIR` | — | provider credentials / capture dir |
| `INBOUND_DOMAIN` | `reply.inqi.example` | replies arrive at `<thread-token>@INBOUND_DOMAIN` |
| `INTAKE_ADDRESS` | — | email-native intake: mail a request to this address, get a report back |
| `SIMULATE_REPLIES` | `false` | demo: role-play a vendor reply after each send — decorates ANY mail driver (postmark too), looped through the real inbound webhook |
| `SIMULATE_REPLY_ROUNDS` | `1` | 1 = quote immediately; 2+ = clarifying question first, full quote last (multi-turn threads) |
| `AUTOPILOT_QUESTIONNAIRE` | `true` | auto-answer the scope questionnaire; `false` = every report waits for the customer |
| `WEBHOOK_INBOUND_USER` / `_PASS` | open (dev) | basic-auth on `POST /api/comms/inbound` |

### Lifecycle & policy

| Env | Default | What it does |
|---|---|---|
| `MFA_MOCK_CODE` | `123456` | two-step email sign-in: the mocked MFA code every sign-in expects (swap for a real emailed one-time code later). Roles live in the **DB** (`db:promote-admin`) — no allowlist |
| `REPORT_COST_CREDITS` | `1` | credits reserved per run (charge on delivery / refund on failure) |
| `QUESTIONNAIRE_TTL_HOURS` | `72` | scope-confirmation link expiry (→ `DROPPED`) |
| `REMINDER_LEAD_HOURS` / `REMINDER_SWEEP_INTERVAL_MS` | `24` / `60000` | expiry reminder timing |
| `REUSE_ENABLED` / `REUSE_SIMILARITY_THRESHOLD` / `REUSE_RADIUS_METERS` / `REUSE_FRESHNESS_DAYS` | on / `0.15` / `50000` / `90` | prior-report reuse gate |
| `COMPLIANCE_FAIL_MODE` / `COMPLIANCE_BORDERLINE_{LOW,HIGH}` | `open` / `0.4`,`0.7` | gate behaviour when the scorer is down; escalation band |
| `STAGE_LEASE_MS` / `REAPER_INTERVAL_MS` / `STAGE_MAX_ATTEMPTS` | `30000` / `10000` / `3` | stage liveness + reaper recovery |
| `AUDIT_RETENTION_DAYS` | built-in | audit-trail window |
| `PRICE_TABLE_JSON` | built-in ($0 local) | model pricing for the cost rollup |

## Worked example (real output)

A full run on the keyless demo (`SIMULATE_REPLIES=true`):

```bash
# 0) Sign in — two steps: request the code, then verify it (mock MFA code: 123456)
curl -s -X POST localhost:4000/api/auth/email -H 'content-type: application/json' \
  -d '{"email":"alice@example.com"}' > /dev/null
ALICE=$(curl -s -X POST localhost:4000/api/auth/email/verify -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","code":"123456"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# 1) Create a report (reserves 1 credit unless it's the free one — 402 if short)
curl -s -X POST localhost:4000/api/reports \
  -H 'content-type: application/json' -H "authorization: Bearer $ALICE" \
  -d '{"rawRequest":"best specialty coffee roasters in Chiang Mai","geo":{"lat":18.79,"lng":98.98,"label":"Chiang Mai, Thailand"}}'
# → { "id": "cmr370…", "state": "RECEIVED", "personaId": "ari", … }

# 2) The live view carries the questionnaire token while scope is unconfirmed
curl -s localhost:4000/api/reports/<id>/live -H "authorization: Bearer $ALICE"
# → { "state": "QUESTIONNAIRE_SENT", "stage": "Questionnaire", "questionnaireToken": "…" }

# 3) Confirm scope → the pipeline runs: breadth (8 inquiries) → depth (sources) → outreach
curl -s -X POST localhost:4000/api/q/<token> -H "authorization: Bearer $ALICE" \
  -H 'content-type: application/json' \
  -d '{"confirmedSubject":true,"answers":{"confirm":"yes","budget":"open","where":"Chiang Mai"}}'

# 4) ~90s later (local model + live SearXNG):
curl -s localhost:4000/api/reports/<id>/live -H "authorization: Bearer $ALICE"
# → { "state": "REPORT_DELIVERED", "stage": "Ready", "qualifiedCount": 8, "delivered": true,
#     "snapshotToken": "…", "options": [ { "subjectProvider": "Graph Coffee Co", … } ] }
```

The matrix it built (real captured rows — 8 inquiries × ≤5 sources, email slot reserved):

```
        inquiry             | web | rating | email | total
----------------------------+-----+--------+-------+------
 Graph Coffee Co            |  3  |   1    |   1   |  5     ← graphcoffeeco.com, /th, instagram
 Cottontree Coffee Roasters |  3  |   1    |   1   |  5
 Ku-Ni Coffee Roaster       |  2  |   1    |   1   |  4     ← only 2 web hits found; under cap
 … (5 more)                 |  3  |   1    |   1   |  5
```

```bash
# 5) The shareable snapshot deep link (owner-gated, HP-24):
#    http://localhost:5173/#/s/<snapshotToken>
curl -s localhost:4000/api/snapshots/<snapshotToken> -H "authorization: Bearer $ALICE"
# → { "reportId": "…", "freemium": true, "unlocked": false, "lockedCount": 7,
#     "options": [ …locked stubs + the #5 taster… ] }

# 6) Freemium unlock (charges 1 credit; 402 when out of credits)
curl -s -X POST localhost:4000/api/snapshots/<snapshotId>/unlock -H "authorization: Bearer $ALICE"

# 7) Operator views (admin = DB role; promote with: pnpm --filter @inqi/backend db:promote-admin <email>)
curl -s localhost:4000/api/reports/<id>/cost -H "authorization: Bearer $ADMIN"   # token+action cost rollup
curl -s localhost:4000/api/reports/<id>      -H "authorization: Bearer $ADMIN"   # board: epics → inquiries → sources
```

## API surface

Global prefix `/api`. Full interactive reference at **`/api/docs`**.

| Surface | Routes |
|---|---|
| **Health** | `GET /health` |
| **Auth** | `POST /auth/email`, `POST /auth/email/verify`, `GET /auth/me`, `GET /me/credits` |
| **Owner/admin** (Bearer, ownership-scoped) | `POST /reports` (credit-gated), `GET /reports`, `GET /reports/:id` (board: epics → inquiries → sources), `GET /reports/:id/live`, `GET /reports/:id/options/:ref/provenance` |
| **Capability-token** (authenticated + owner-gated) | `GET\|POST /q/:token`, `GET /snapshots/:token` |
| **Freemium** | `POST /snapshots/:id/unlock` (charges 1 credit) |
| **Admin** | `GET /reports/:id/cost`, `POST /reports/:id/{cancel,pause,resume}`, `GET /comms/thread/:inquiryId`, `POST /admin/customers/:id/credits`, `GET /admin/customers`, `GET /workflows{,/:id,/:id/diff}`, `POST /workflows/:id/publish`, `GET /audit` |
| **Webhooks** | `POST /comms/inbound` (signed) |

## CI/CD

GitHub Actions, fully **hermetic** (no repo secrets):

- **[`ci.yml`](.github/workflows/ci.yml)** — every PR + push to `main`: `pnpm -r build`
  (the `tsc`/`nest build` type-check gate) + tests against a real Postgres
  (pgvector + PostGIS built from `db/`), with `prisma db push` + `init.sql` + seed.
  Drivers run keyless, so forks/untrusted PRs run green with no secrets.
- **[`release.yml`](.github/workflows/release.yml)** — on `main` + `v*` tags: builds
  the backend + frontend images (`docker/*.Dockerfile`) and pushes to **GHCR**
  (`ghcr.io/andrew-vogulkin/inqi-backend`, `…/inqi-frontend`) via `GITHUB_TOKEN`;
  the `deploy` job is a documented stub gated by the `production` Environment.

Hardening: least-privilege `permissions:`, `concurrency` cancel-in-progress, actions
pinned to major tags (pin to SHAs for stricter supply-chain hardening), secrets only in
GitHub Secrets/Environments. Protect `main` with **CI / build-test** as a required check.

## Layout

- `backend/`  NestJS API, versioned workflow engine, pg-boss agent workers, WS gateway
- `frontend/` React app — customer view + admin live board (+ Playwright e2e in `frontend/e2e/`)
- `packages/shared/` shared TypeScript types (events, workflow, enums, DTOs)
- `db/` Postgres image (PostGIS + pgvector); `docker/` production image Dockerfiles
- `backend/prisma/` schema, `sql/init.sql` (extensions + NOTIFY trigger), `seed.ts`

## More

- **Architecture & rationale:** [DESIGN.md](DESIGN.md)
- **API reference:** `/api/docs` (Swagger, served by the running backend)
- **Feature handovers / decisions:** [Notion — inqi space](https://app.notion.com/p/38dab80b77f281518161cd9333bc2fbf) · [Handover Prompts](https://app.notion.com/p/38dab80b77f28115afd5e239e83fecb2)

## Status

HP-01 → HP-24 implemented and verified: schema, versioned workflow engine + v1/v2 seed,
realtime plumbing, intake/questionnaire/compliance, the breadth → depth research
pipeline (**Report 1:M Inquiry 1:M Source**, 8×5 limits, all queue-driven), personas
(1:1 per report), prior-report reuse, live reports (customer + admin, with the source
matrix), auth (Google + stub, DB-owned roles), freemium snapshots + credits, operator
controls, workflow-version management, audit trail, notifications, per-report cost
accounting, and hermetic CI/CD. Verified end-to-end: 156 backend + 149 frontend unit
tests, 56 Playwright e2e, plus live runs against the local model + self-hosted SearXNG.
Real cloud deploy and live email providers are left as documented stubs/seams.

## License

[AGPL-3.0](LICENSE). You can use, modify and self-host inqi freely; if you offer a
modified version as a service, the AGPL requires you to open-source your version.
**Commercial licensing** (proprietary use without AGPL obligations) is available —
contact the author.

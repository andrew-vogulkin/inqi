# inqi — Devpost project description (Autopilot Agent track)

> Paste into Devpost "About the project" from `## Inspiration` down. Content is
> aligned to the judging rubric — Innovation & AI Creativity (30%), Technical
> Depth & Engineering (30%), Problem Value & Impact (25%), Presentation &
> Documentation (15%) — with links into the code for every substantial claim.

**Tagline:** One report. AI agents on it. Customer inquiry → vendor discovery →
real email outreach → negotiated replies → ranked quotes. Unattended — and
self-improving.

---

## Inspiration

Sourcing a vendor is tedious back-and-forth work that consumes hours of human
attention — searching, comparing, form-filling, email ping-pong. Meanwhile the
world is moving to faster business cycles and faster decision-making. inqi is a
first step toward closing that gap: a **workflow state machine infused with AI
capabilities to analyse and compose**, automating the whole process up to the
decision point. The track brief's first example — *"customer inquiries to
quotes"* — is literally what inqi does.

## What it does

inqi is a service **for humans and for other agents**: it takes a request
through the web interface or by plain email
([intake.service.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/agent/intake.service.ts))
and delivers the result without requiring further attention. The demo case:
*"facade scaffolding rental including assembly and dismantling, about 600 m²,
10-week renovation project in The Hague"* — a request where quotes genuinely
spread 2× across vendors, so the ranking and negotiation earn their keep:

1. **Pre-research + scope questionnaire**: compliance-gates the request, then
   confirms scope with a short questionnaire whose options the agent generated
   itself ([questionnaire-generator.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/questionnaire/questionnaire-generator.ts)) —
   any question can be left to the agent ("decide for me").
2. **Breadth discovery**: Qwen forms search queries (in Dutch *and* English for
   a Dutch job), mines real provider pages, and tells specific providers apart
   from aggregators and directories — marketplaces inform the hunt but never
   count as results ([breadth-lifecycle.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/subject-providers/breadth-lifecycle.ts)).
3. **Outreach**: emails shortlisted businesses under a region-matched,
   per-report persona (DKIM-signed, per-thread reply routing —
   [email.service.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/source/email.service.ts)).
4. **Multistage reply loop**: every vendor reply is *evaluated* (real answer?
   counter-question? risk?) before it is *answered* — the agent never invents
   commitments, yet carries every conversation to a quoted price
   ([agent.service.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/agent/agent.service.ts)).
   In production this negotiated an actual price with a real dog-grooming
   salon — a 20 EUR first-visit groom, confirmed over a multi-turn thread.
5. **Depth research + synthesis**: verifies claims, ranks options, and delivers
   a report with evidence, quoted prices **with the unit they were quoted in**
   (€9.50/m² is not comparable to a €18,500 job total — inqi keeps the basis and
   ranks only like against like:
   [ranking.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/snapshot/ranking.ts)),
   and honest caveats where vendors didn't answer — by email and live web view.

**The golden point: inqi is built to improve itself — on three legs.**

1. **Genes + dynamic workflows = long-term research memory.** The pipeline runs
   on DB-versioned workflow graphs with tunable "genes" (discovery caps, wave
   plans, gate thresholds —
   [phase-tunables.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/phases/phase-tunables.ts)).
   What the system learns from delivered reports is written back into the next
   workflow version — knowledge accumulates in the genome, not in someone's
   head. Operators publish new versions live from the admin console, no
   redeploy; the publish gate scores every proposal, and **auto-approve** lets a
   proposal that beats the incumbent publish itself. The demo itself ran on a
   version published this way (v3: a wider first outreach wave).
2. **Golden cassettes = the stabilisation phase.** Real phase runs are recorded
   and replayed to *score* every candidate configuration or model before it
   ships ([rehearsal/](https://github.com/andrew-vogulkin/inqi/tree/main/backend/src/infra/rehearsal)) —
   regression testing that respects LLM non-determinism (scores, not
   exact-match assertions). Nothing publishes on vibes.
3. **Live reports — delivery is not the end.** A report is not a static PDF: if
   a vendor replies after delivery, the reply runs the normal evaluation loop,
   the options are **re-ranked and the summary re-synthesized in place**, and
   the customer is notified
   ([snapshots.service.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/snapshot/snapshots.service.ts)).
   Every report stays actual — recalculated on meaningful events.

The customer pays **on delivery** from a credit ledger; a report that fails
costs nothing.

## Problem value · 25%

- **$50–150** — what 2–4 hours of a procurement specialist's sourcing time
  costs, per task. **≈ $0.50** — what the demo report cost in metered compute
  (Qwen tokens + searches + emails): 100–300× cheaper, every cent itemized in
  the operator console. **0 credits** — the cost to the customer when a run
  fails: pay on delivery.
- The filmed demo run, **fully metered, not estimated**: ~870k Qwen tokens ·
  ~250 AI calls · ~140 web searches · 4 parallel email negotiations · under
  half a dollar all-in. Lighter consumer requests (grooming, coffee, ceramics
  in our production runs) land well under that.
- **Who needs it**: construction & industrial procurement (materials, machinery,
  plant hire), SMB purchasing, competitor analytics, concierge services,
  marketplaces onboarding supply — and **other AI agents**: inqi speaks email
  natively, so any assistant with email access can delegate real-world sourcing
  to it. Request in, ranked report back.

## How we built it

**Innovation & AI creativity · 30%**

- **Sophisticated use of Qwen Cloud**: every model call goes to DashScope — an
  OpenAI-compatible client with per-phase model tiers, JSON-mode
  schema-validated structured output, and an **agentic tool loop** where Qwen
  drives `web_search` and a real headless-browser `open_url` tool during depth
  research ([qwen-provider.base.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/infra/ai/qwen-provider.base.ts) ·
  [config.service.ts#L13](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/infra/config/config.service.ts#L13)).
  20+ specialized prompts live in one inspectable module
  ([prompts.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/infra/ai/prompts.ts)).
- **Self-improving workflows (genes)** — the versioned-genome loop above:
  run → measure → propose → rehearse → publish, with auto-approve designed into
  the publish gate.
- **Per-report personas** — a Rotterdam machinery inquiry is carried end-to-end
  by one region-matched voice; pinned 1:1 so the fleet never reads as one bot
  ([personas.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/agent/personas.ts)).
- **Multistage reply loop with a target goal** — every thread drives toward a
  concrete cost estimate + timeline: evaluate the vendor's email, answer their
  questions from the customer's scope (never imagination first), push to a
  comparable price ([agent.service.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/agent/agent.service.ts)).
- **Self-evaluation loops** — the depth-research verdict is audited by an
  evidence gate that names concrete gaps to close before a candidate settles,
  and every outbound draft passes a progress + topic-correlation check before
  sending ([background.prompt.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/subject-providers/background.prompt.ts) ·
  [reply.prompt.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/agent/reply.prompt.ts)).

**Technical depth & engineering · 30%**

- **DB-versioned state machines — built for dynamic updating**: the report
  lifecycle plus three child workflows (`pre_research`, `breadth_search`,
  `depth_search`) are persisted, versioned state graphs advanced with optimistic
  transitions; operators inspect, diff and publish live
  ([workflow-engine.service.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/orchestrator/workflow-engine.service.ts) ·
  [phases/](https://github.com/andrew-vogulkin/inqi/tree/main/backend/src/domain/phases)).
- **Crash-safe autonomy**: pg-boss job queue, leases + a reaper that recovers
  stuck runs, idempotent credit settlement, outbox events streaming to a
  realtime UI ([orchestrator.service.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/orchestrator/orchestrator.service.ts)).
- **Deliverability engineering**: two DKIM-signed sender identities (system
  mail vs persona outreach), RFC threading headers, per-thread reply routing
  into the inbound webhook, bounce/suppression handling, decline cool-downs so
  the intake address can't become a spam reflector.
- **Autonomy with brakes**: compliance gates on customer prompts AND inbound
  vendor replies ([compliance.service.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/compliance/compliance.service.ts)),
  bounded reply turns, operator hold/cancel controls, and a full audit trail —
  the agent is autonomous, never unaccountable.
- **Runs entirely on Alibaba Cloud**: single ECS instance, Docker Compose,
  Caddy TLS, on-box Postgres
  ([deploy/docker-compose.prod.yml](https://github.com/andrew-vogulkin/inqi/blob/main/deploy/docker-compose.prod.yml)).
  NestJS + Prisma backend, React frontend, shared typed contract package,
  **550+ backend tests**. Architecture diagrams:
  [infra](https://github.com/andrew-vogulkin/inqi/blob/main/docs/hackathon/inqi-architecture-infra.png) ·
  [main flow](https://github.com/andrew-vogulkin/inqi/blob/main/docs/hackathon/inqi-architecture-flow.png).

## Challenges we ran into

- **Tuning an autopilot is a moving target.** Change a model or a parameter and
  quality — or cost — regresses silently. Our answer: **golden-cassette
  recordings** of real phase runs, replayed and *scored* by rehearsal drivers
  before a configuration ships. Built around LLM non-determinism from day one:
  we score outcomes, we don't assert exact outputs.
- **Rates are not totals.** Real research surfaced €10/m² rates next to €18,500
  job quotes — and a naive ranking called the rate "cheapest." We shipped
  basis-aware ranking mid-hackathon: prices carry the unit they were quoted in,
  only like competes against like, and the ranked list now agrees with the AI
  synthesis verdict
  ([ranking.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/snapshot/ranking.ts)).
- **Moving between models, safely.** Every model swap shifts tone, JSON
  discipline and cost. We migrate by rehearsal: record real runs as golden
  cassettes, replay them against the candidate Qwen model, compare quality and
  spend — then flip a config flag. No big-bang migrations.
- **Token burn vs depth of analysis.** Deep research wants strong models, and
  strong models cost. Workflow-level fixes carried most of the weight — query
  dedupe, cycle caps, evidence floors cut our discovery search volume ~10× with
  no quality loss — and **Qwen Cloud carried the rest: qwen3.6-plus gives us
  depth-quality results in a token budget smaller models need multiple passes
  for**. That's what keeps even a heavy industrial report around half a dollar.

## Accomplishments that we're proud of

- A real multi-turn **price negotiation with a real business**, conducted
  autonomously and safely.
- A **production operator console** with full cost transparency: every AI call,
  search and email usage-recorded with its price — per-report cost view, live
  board, run controls, credit approve/reject, audit trail and workflow version
  publishing.
- Judges can try it live: **sign up at inqi.monkeycode.io and the system grants
  10 credits automatically** — run your own report during judging.

## What we learned

Production-ready agent work is 20% prompting and 80% systems engineering:
idempotency, recovery, money invariants, deliverability, honest gates — and a
regression harness that respects non-determinism. Every "it works" claim we made
was later corrected by running the real thing, so we kept the bugs in the story.

## What's next for inqi

Today inqi owns the **last mile** — one concrete inquiry, end to end. The road
ahead:

- **T+1 — high-level orchestration**: one goal decomposed into many inqi reports
  running in parallel, synthesized into a single plan + budget. *Wedding = Venue
  + Photographer + Catering + Florist + Music. Construction = Architect + Design
  + Materials + Machinery + Permits.*
- **T+2 — topic research reports**: the same engine — discover, verify,
  negotiate, synthesize — pointed at open-ended topics: market scans, competitor
  watch, standing reports that refresh themselves.
- Plus: closing the self-improvement loop end-to-end (the system proposing and
  rehearsing its own next workflow version from delivered-report outcomes),
  payment-backed top-ups, provider-side scheduling (quotes → booked
  appointments), and multi-language outreach personas.

---

*Demo note (transparency): in production, inqi emails real businesses. For
judging, vendor replies are simulated
([simulated-replies.provider.ts](https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/domain/source/simulated-replies.provider.ts) —
a decorator over the real mail transport, looped through the production inbound
webhook) so demo runs don't spam real shops — the real-mode Hundesalon thread in
our materials is the identical loop against a real business.*

**Built with:** Qwen Cloud (DashScope) · Alibaba Cloud ECS · NestJS · Prisma ·
PostgreSQL · pg-boss · React · Vite · Postmark · Serper/SearXNG · Docker · Caddy

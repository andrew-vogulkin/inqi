# inqi — Devpost project description (Autopilot Agent track)

> Paste into Devpost. Headings follow Devpost's standard template. Fill [numbers]
> from the final demo run before submitting.

**Tagline:** One report. AI agents on it. Customer inquiry → vendor discovery →
real email outreach → negotiated replies → ranked quotes. Unattended — and
self-improving.

---

## Inspiration

Sourcing a vendor is the most universal "autopilot" workflow there is — and
nowhere does it bite harder than in **construction and industrial procurement**:
finding a plant-hire company for a 14-tonne excavator, or a materials supplier
for a site, means hours of googling, form-filling and email ping-pong across
vendors whose prices vary wildly for the same machine. It's exactly the shape of
work an agent should own end-to-end: research, outreach, negotiation, synthesis.
The track brief's first example — *"customer inquiries to quotes"* — is
literally what inqi does. Who needs it: construction & industrial procurement
(materials, machinery, plant hire), SMB purchasing, competitor analytics,
concierge services, marketplaces onboarding supply.

## What it does

Send inqi a request — from the web app or by simply **emailing the intake
address** — and it runs the entire loop unattended. The demo case: *"facade scaffolding
rental including assembly and dismantling, about 600 m², 10-week renovation
project in The Hague"* — a request where quotes genuinely spread 2× across
vendors, so the ranking and negotiation earn their keep:

1. **Pre-research + scope questionnaire**: compliance-gates the request, then
   confirms scope with a short questionnaire whose options the agent generated
   itself — any question can be left to the agent ("decide for me").
2. **Breadth discovery**: Qwen forms search queries (in Dutch *and* English for
   a Dutch job), mines real provider pages, and tells specific providers apart
   from aggregators and directories — marketplaces inform the hunt but never
   count as results.
3. **Outreach**: emails shortlisted businesses under a region-matched, per-report
   persona (DKIM-signed, per-thread reply routing).
4. **Multistage reply loop**: every vendor reply is *evaluated* (real answer?
   counter-question? risk?) before it is *answered* — the agent never invents
   commitments, yet carries every conversation to a quoted price. In production
   this negotiated an actual price with a real dog-grooming salon — a 20 EUR
   first-visit groom, confirmed over a multi-turn thread.
5. **Depth research + synthesis**: verifies claims, ranks options, and delivers
   a report with evidence, quoted prices **with the unit they were quoted in**
   (€9.50/m² is not comparable to a €18,500 job total — inqi keeps the basis and
   ranks only like against like), and honest caveats where vendors didn't
   answer — by email and live web view.

**The golden point: inqi is built to improve itself.** The pipeline doesn't run
on hard-coded logic — it runs on **DB-versioned workflow graphs with tunable
"genes"** (discovery caps, wave plans, gate thresholds). Delivered reports are
scored, synthesized, and fed back: operators publish improved workflow versions
from the admin UI — no redeploy — and **golden-cassette recordings** of real runs
let every candidate configuration be rehearsed and scored before it ships. That's
continuous learning the way a human team does retros: run → measure → propose →
rehearse → publish. The publish gate already scores every proposal against
rehearsals; **auto-approve** — designed into the publish gate — makes a proposal
that beats the incumbent publish itself. The demo itself ran on a version
published this way (v3: a wider first outreach wave). The workflow isn't code
someone edits: it's a genome the system iterates.

The customer pays **on delivery** from a credit ledger; a report that fails costs
nothing.

## How we built it

- **Qwen Cloud (DashScope)** for every model call — **qwen3.6-plus end to end**
  today, with a phase-tier system already wired in: breadth, depth/reply and
  synthesis each resolve their model from config, so stronger or cheaper Qwen
  models slot into any phase with a flag flip, no code change. Quality per token
  is the whole unit-economics story — qwen3.6-plus delivers depth-grade output
  a smaller model would need multiple passes for.
- **Alibaba Cloud ECS** (single instance, Docker Compose, Caddy TLS, on-box
  Postgres) — the whole product runs on Alibaba infrastructure.
- **DB-versioned workflow state machines** — built specifically for *dynamic
  workflow updating*: the report lifecycle plus three child workflows
  (pre_research, breadth_search, depth_search) are persisted, versioned state
  graphs. Operators inspect, diff, and publish new versions live from the admin
  console; the diagrams render sub-workflow hand-offs (`STATE ↪ child`).
- **Golden cassettes + rehearsal drivers** — real phase runs are recorded and
  replayed to *score* parameter and model changes (scores, not exact-match
  assertions — respecting LLM non-determinism). Regression testing for agents.
- **Crash-safe autonomy**: pg-boss job queue, leases + a reaper that recovers
  stuck runs, optimistic state transitions, idempotent credit settlement, outbox
  events streaming to a realtime UI.
- **Deliverability engineering**: two DKIM-signed sender identities (system mail
  vs persona outreach), RFC threading headers, per-thread reply routing into the
  inbound webhook, bounce/suppression handling, decline cool-downs so the intake
  address can't be turned into a spam reflector.
- **NestJS + Prisma backend, React frontend, shared typed contract package;
  550+ backend tests** including regression tests written from live failures.

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
  synthesis verdict.
- **Moving between models, safely.** Every model swap shifts tone, JSON
  discipline and cost. We migrate by rehearsal: record real runs as golden
  cassettes, replay them against the candidate Qwen model, compare quality and
  spend — then flip a config flag. No big-bang migrations.
- **Token burn vs depth of analysis.** Deep research wants strong models, and
  strong models cost. Workflow-level fixes carried most of the weight — query
  dedupe, cycle caps, evidence floors cut our discovery search volume ~10× with
  no quality loss — and **Qwen Cloud carried the rest: qwen3.6-plus gives us
  depth-quality results in a token budget smaller models need multiple passes
  for**. That's what keeps even a heavy industrial report around half a dollar —
  and the wired-in phase tiering (fast models where breadth is enough, strong
  where reasoning matters) is the next dial down.

## Accomplishments we're proud of

- A real multi-turn **price negotiation with a real business**, conducted
  autonomously and safely.
- A **production operator console** with full cost transparency: every AI call,
  search and email is usage-recorded with its price — the per-report cost view
  shows exactly how a total is built, next to live board, run controls, credit
  approve/reject, audit trail and workflow version publishing.
- Unit economics you can read off a screen: the demo report cost ≈ **$0.50** of
  metered compute (Qwen tokens + searches + emails) against **$50–150 of
  office-worker time** it replaces — 100–300× cheaper, with every cent itemized
  in the operator console.
- The filmed demo run — **fully metered, not estimated**: ~870k Qwen tokens ·
  ~250 AI calls · ~140 web searches · 4 parallel email negotiations · under
  half a dollar all-in. Lighter consumer requests (grooming, coffee, ceramics
  in our production runs) land well under that.
- Judges can try it live: **sign up at inqi.monkeycode.io and the system grants
  10 credits automatically** — run your own report during judging.

## What we learned

Production-ready agent work is 20% prompting and 80% systems engineering:
idempotency, recovery, money invariants, deliverability, honest gates — and a
regression harness that respects non-determinism. Every "it works" claim we made
was later corrected by running the real thing, so we kept the bugs in the story.

## What's next

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

And because inqi speaks email natively, it's built to be **an extension for
other agents**: any assistant with email access can already delegate real-world
sourcing to inqi — request in, ranked report back.

---

**Demo mode note (transparency):** in production, inqi emails real businesses.
For judging, vendor replies are simulated so the demo doesn't spam real shops —
the real-mode Hundesalon thread in the video shows the identical loop against a
real business.

**Built with:** Qwen Cloud (DashScope) · Alibaba Cloud ECS · NestJS · Prisma ·
PostgreSQL · pg-boss · React · Vite · Postmark · Serper/SearXNG · Docker · Caddy

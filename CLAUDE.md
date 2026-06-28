# CLAUDE.md — inqi

Orientation for working in this repo. Read this first, then `DESIGN.md` (the
architectural source of truth) and the Notion handover space linked below.

## What we're building

**inqi** is an **AI-driven inquiry & research workflow**. A customer asks for
something they're trying to find — an item, a service, a place to rent, an
organisation, goods, or a trade. Instead of a human doing the long, tedious
legwork, AI agents own the whole pipeline with minimal-to-no human involvement
and return a **report of what's available**: cost options, constraints, and a
timeline of the actions taken.

The pipeline, end to end:

1. **Inquiry** comes in (free-text description of what they want).
2. **Pre-research + ethical/feasibility evaluation** — enrich the subject and
   either build a confirmation **questionnaire** (tokened, expiring link) or deny.
   Check for a reusable prior report in a nearby geo area.
3. **Enrichment + broad research** once the questionnaire is confirmed — geo,
   time, price, and economic-sense constraints; start narrowing the funnel.
4. **Funnel → outreach** — form a list of **subject providers**, create an
   **Epic** with agent **Subtasks**, and have agents email providers. Outreach
   follows a strategy (one-by-one, escalating 1:3:9, or parallel).
5. **Report** — synthesize cost options + constraints + quality + timeline.
6. **Delivery** — shown to the customer via a live webview.

## Key concepts & vocabulary

- **subject provider** — an entity that may supply the customer's subject (seller,
  service, landlord, org). Deliberately distinct from the **email provider**
  (Postmark) and the **AI/model provider** (Qwen). Use `subjectProvider*` in code.
- **Orchestrator vs Agent** — two *roles in this one backend*, not separate apps.
  Orchestrator manages completion/retry/priority/rate-limiting (triggered by epic
  creation + subtask completion/failure); Agent does research and carries the
  email conversation (triggered by subtask creation + inbound email).
- **Versioned workflow** — transition logic lives in the DB and is *pinned per
  inquiry*, so workflow upgrades never break in-flight work. This is what makes
  incremental self-improvement safe.
- **Personas** — 8 region-aware proxy-hub agent personas; the same persona owns an
  email thread for its whole life.
- **Compliance gate** — every outbound email and questionnaire is ethical+legal
  scored before it leaves inqi.
- **Dynamic report** — assembled on read from a `Finding` store as agents work.

## Tech stack (and the hard constraints)

- **Backend:** NestJS (TypeScript).
- **Frontend:** React + Vite (one app, customer view + admin live board).
- **Database: Postgres only** — also the queue (pg-boss), realtime (EventOutbox +
  `LISTEN/NOTIFY`), similarity (pgvector), and geo (PostGIS). **No Redis.**
- **Realtime:** Socket.IO over WebSockets (not WebRTC).
- **AI:** Qwen (DashScope, OpenAI-compatible), behind a breadth/depth/balanced
  model-tier router. Breadth = cheap (qwen-turbo) for wide research; depth =
  strong (qwen-max) for per-provider research, email drafting/replies, synthesis.
- **Email:** Postmark (send + inbound parse webhook → `POST /api/comms/inbound`).

## Repo layout (monorepo — pnpm workspaces)

```
inqi/
├─ DESIGN.md                source of truth for architecture
├─ CLAUDE.md                this file
├─ docker-compose.yml       Postgres (postgis) + backend + frontend
├─ packages/shared/         TS types shared by FE + BE (events, workflow, DTOs)
├─ backend/                 NestJS
│  ├─ prisma/schema.prisma  DB schema (authoritative)
│  ├─ prisma/seed.ts        workflow v1
│  ├─ prisma/sql/init.sql   extensions (vector, postgis) + NOTIFY trigger
│  └─ src/{inquiries,questionnaire,subjects,epics,subtasks,comms,reports,
│           workflow,agents,events,ai,queue}/
└─ frontend/                React + Vite (src/customer, src/admin, src/lib)
```

Frontend and backend share `packages/shared`, so event/DTO/workflow types stay in
sync at compile time. One install, one compose, one PR can span the stack.

## Local development

```bash
cp .env.example .env          # set QWEN_API_KEY (and POSTMARK_* for real email)
pnpm install
docker compose up -d db
pnpm db:migrate               # create schema
psql "$DATABASE_URL" -f backend/prisma/sql/init.sql   # extensions + NOTIFY trigger
pnpm db:seed                  # install workflow v1
pnpm dev                      # backend :4000 + frontend :5173
```

Set `SIMULATE_REPLIES=true` (default in `.env.example`) to make the pipeline run
end-to-end without a real email provider wired in.

## Where the stubs are (intentional TODOs)

The skeleton runs end to end with realistic events; the AI/IO substance is stubbed
and clearly marked. Replace, roughly in this order:

1. Qwen prompts — pre-research/ethical eval, enrichment, broad research, report
   synthesis (structured outputs + validation).
2. Real Postmark send + inbound webhook signature verification (`CommsService`).
3. Compliance scoring rubric (`scoreCompliance`) for emails + questionnaires.
4. Subject-provider background research (ratings/feedback/eligibility) → `Finding`.
5. Prior-report reuse (pgvector embeddings + PostGIS distance).

## Documentation & handover (Notion)

Full specs with diagrams live in the Notion handover space:

- **Main page:** https://app.notion.com/p/38dab80b77f281518161cd9333bc2fbf
- [1 — Architecture Diagram](https://app.notion.com/p/38dab80b77f281d6bf9bd925bc8a9ba3)
- [2 — Workflow Diagram (State Machine)](https://app.notion.com/p/38dab80b77f28136bf88d09e8b210204)
- [3 — Tech BOM](https://app.notion.com/p/38dab80b77f281f1a413ca58adb989e5)
- [4 — Epic + Subtask Lifecycle & Verification](https://app.notion.com/p/38dab80b77f28162b454f2d6aed3b830)
- [5 — Research Strategy Workflow](https://app.notion.com/p/38dab80b77f2815bafc0f03e8a05ec4f)
- [6 — Report Structure](https://app.notion.com/p/38dab80b77f281bd9cbad269b6d3dfcf)
- [7 — Backend ↔ Frontend Interaction](https://app.notion.com/p/38dab80b77f281d88e67c61518aea293)
- [8 — Repo Layout & Handover Notes](https://app.notion.com/p/38dab80b77f281bea015c2b914af9b52)
- [9 — Agent Communication Track (Email Threading)](https://app.notion.com/p/38dab80b77f281fd95c9c78d696fff87)
- [10 — Orchestrator Model Sizing](https://app.notion.com/p/38dab80b77f281429d1aff2e00f47664)
- [11 — Orchestrator & Agents](https://app.notion.com/p/38dab80b77f2810897acf12bc7e3a4d0)
- [12 — Agent Personas](https://app.notion.com/p/38dab80b77f281be898effbfa745affb)
- [13 — Compliance Scoring (Ethical + Legal)](https://app.notion.com/p/38dab80b77f2819f9a40e4b033da6541)
- [14 — Self-Improvement & Dynamic Workflows](https://app.notion.com/p/38dab80b77f281159933f8ae58649048)

## Backend module layout (target)

Three layers (a restructure of the current flat `src/`):

- **Edge / ingress** — `public` (unauthenticated intake), `auth` (login + guards),
  `capability-token` (no-login tokened links: questionnaire fill, report webview),
  `webhooks` (signature-verified machine ingress, e.g. Postmark inbound).
- **Domain** — `inquiry`, `questionnaire`, `subjects`, `subject-providers`,
  `orchestrator` (workflow + retry/priority/rate-limit), `agent` (logic + personas),
  `outreach` (messages/email, `MailProvider` via DI), `reports` (synthesis + dynamic
  assembly), `compliance` (ethical+legal scoring), `eval` (self-improvement),
  `kanban` (read/projection over epics+subtasks — mutations stay in orchestrator/agent).
- **Infra (`@Global`)** — `ai` (Qwen + tier router), `events` (EventOutbox +
  LISTEN/NOTIFY + WS gateway), `queue` (pg-boss), `persistence` (Prisma), `config`,
  `observability` (health + AgentRun/AgentEvent).

Swappable integrations depend on **interface tokens**, not concretions: `MailProvider`
(Postmark→SES/Resend), `AiProvider` (Qwen), `EmbeddingsProvider`, `ComplianceScorer`.

## Conventions

**Architecture**

- Keep the **"Postgres only"** constraint — no new datastores/brokers.
- New agent behavior = a named guard/action in `workflow/registry` referenced from a
  **new workflow version**, never a breaking edit to an existing version.
- All realtime goes through `EventOutbox` (durable + replayable), never emitted
  straight to sockets.
- Use the model-tier router (`breadth`/`depth`/`balanced`); never hard-code model names.
- Depend on interface tokens for swappable integrations (`MailProvider`, `AiProvider`, …).
- `kanban` is the query side over epics/subtasks; mutations live in `orchestrator`/`agent`.

**Code style (enforced)**

- **DTOs everywhere.** Every controller request and response is a typed, validated DTO
  (class-validator + a global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`).
- **Business logic lives in services.** Controllers stay thin (validate → call service →
  return DTO). Repositories are dumb data-access that expose only the model API needed.
- **No magic strings.** Every status / state / event / kind / tier / strategy is an enum
  or a shared const union (in `packages/shared`) — never a bare string literal.
- **AI-readable errors.** Throw typed domain exceptions; a global exception filter maps
  them to a stable envelope `{ error: { code, message, retryable, details } }`. Wrap
  AI/IO failures with a `code` so the orchestrator can decide retry vs. deny.
- **Swagger-complete.** Every endpoint has `@ApiTags`/`@ApiOperation`/`@ApiResponse`;
  every DTO field has `@ApiProperty` with an example. Payloads, params, and examples must
  render in `/api/docs`.
- **Object args.** Functions take one typed object, not positional params:
  `fn({ uuid, type }: ITestCall)` — not `fn(uuid, type)`.

# inqi

[![CI](https://github.com/andrew-vogulkin/inqi/actions/workflows/ci.yml/badge.svg)](https://github.com/andrew-vogulkin/inqi/actions/workflows/ci.yml)

**AI-driven inquiry & research workflow.** A customer describes what they're after —
an item, service, rental, organisation, goods or a trade. AI agents vet the request,
confirm scope with a short questionnaire, discover candidate providers, reach out to
them by email, and assemble a **live, ranked cost-&-constraints report** the customer
watches build in real time.

> **Accuracy over aspiration:** this README is generated from the real repo (the
> `backend/src` module tree, `package.json` scripts, `.env.example`, the seeded
> workflow). Architecture rationale lives in **[DESIGN.md](DESIGN.md)**; per-feature
> handovers live in the [Notion space](https://app.notion.com/p/38dab80b77f281518161cd9333bc2fbf).

## The pipeline

```
RECEIVED → PRE_RESEARCH → QUESTIONNAIRE_SENT → (customer confirms scope)
         → research / discovery → outreach (waves of providers, by email)
         → replies qualified → REPORT_GENERATED → REPORT_DELIVERED
```

The state machine is **stored in the DB and versioned** (a shipped version is
immutable; new behaviour folds into the working version). The seed installs:

- **v1** — 11 states / 10 transitions — *archived, immutable* (any inquiry still pinned to it keeps running on it).
- **v2** — 14 states / 28 transitions — *active* — adds `FAILED` / `CANCELLED` / `ON_HOLD`, prior-report reuse, and operator pause/resume/cancel.

Terminal states: `REPORT_DELIVERED`, `DENIED`, `DROPPED`, `FAILED`, `CANCELLED`.
Full state graph: see [DESIGN.md](DESIGN.md).

## Stack & hard constraints

- **Backend** — NestJS 10 (modular DI), Prisma 5.
- **One datastore: Postgres.** Data **+** `pgvector` (subject similarity) **+** PostGIS
  (geo) **+** `pg-boss` job queue **+** `LISTEN/NOTIFY`. No Redis, no Kafka.
- **Realtime** — `EventOutbox` → Postgres `NOTIFY` → Socket.IO gateway (with cursor replay).
- **Frontend** — React 18 + Vite (no backend logic; pure view over events/DTOs).
- **AI** — Qwen (DashScope cloud *or* a local spark endpoint), behind a provider seam;
  **degrades gracefully with no key** for keyless demos.
- **Shared types** — `packages/shared` (events, workflow, enums, DTOs) used by both ends.

## As-built structure

Monorepo (pnpm workspaces: `backend`, `frontend`, `packages/*`). The backend is split
into three tiers — **`edge/`** (ingress), **`domain/`** (business logic), **`infra/`**
(cross-cutting). This matches `find backend/src -type d`:

```
backend/src
├─ edge/                     # ingress — HTTP controllers + DTOs + guards
│  ├─ public/                #   intake + live report (no auth)
│  ├─ capability-token/      #   questionnaire + report via opaque token (no login)
│  ├─ auth/                  #   Google sign-in, sessions, owner/admin-scoped inquiries,
│  │                         #   workflow-version admin, audit, cost, comms thread
│  └─ webhooks/              #   inbound provider email (signed)
├─ domain/                   # business logic (one module per capability)
│  ├─ inquiry/               #   intake + lifecycle
│  ├─ questionnaire/         #   scope confirmation
│  ├─ compliance/            #   request vetting / scoring  (COMPLIANCE_SCORER seam)
│  ├─ subjects/              #   subject identity + prior-report reuse (pgvector/PostGIS)
│  ├─ subject-providers/     #   provider discovery + background research + ratings
│  ├─ orchestrator/          #   versioned workflow engine, planning, stage workers,
│  │                         #   pause/resume/cancel, reaper, workflow-version admin
│  ├─ agent/                 #   outreach personas + agent runs
│  ├─ outreach/              #   provider email send/receive + threads (MAIL_PROVIDER seam)
│  ├─ reports/               #   live assembly + ranking + synthesis (report token)
│  ├─ notifications/         #   customer emails + questionnaire reminders (NOTIFICATION_CHANNEL)
│  ├─ customer/              #   customer accounts (auth linkage)
│  ├─ kanban/                #   board projection for the admin view
│  └─ eval/                  #   self-eval scaffold
├─ infra/                    # cross-cutting
│  ├─ config/                #   typed env access (the only place process.env is read)
│  ├─ persistence/           #   Prisma client
│  ├─ queue/                 #   pg-boss
│  ├─ events/                #   EventOutbox + LISTEN/NOTIFY + Socket.IO gateway
│  ├─ ai/                    #   Qwen cloud/local providers + embeddings + token-usage capture
│  ├─ observability/         #   health, activity, audit, reaper logic
│  └─ usage/                 #   token + outreach cost ledger (rollup → cost endpoint)
└─ common/                   # error envelope (typed { error } ) + logging interceptor
```

```
frontend/src
├─ App.tsx                   # hash router + auth-aware nav
├─ customer/                 # intake, own live view, public /r/:token deep link, dashboard
├─ admin/                    # live board: inquiries → epics → subtasks, workflows, audit, cost
└─ lib/                      # api client, socket (replay), auth (session), Google sign-in
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
CI runs this same DB → push → `init.sql` → seed → build → test sequence hermetically
(see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Provider / env matrix

All env is read in one place (`backend/src/infra/config/config.service.ts`). Swappable
seams pick a driver by env; **omit the credential and the demo still runs.**

| Seam | Env | Default → alternative |
|---|---|---|
| **AI** (`AI_PROVIDER`) | `AI_DRIVER`, `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL{,_BREADTH,_DEPTH}` | `qwen_cloud` (DashScope) → `qwen_local` (`QWEN_LOCAL_BASE_URL`, alias `qwen`). No key → graceful fallback. |
| **Embeddings** | `EMBEDDINGS_DRIVER`, `EMBEDDINGS_{API_KEY,BASE_URL,MODEL,DIM}` | local fallback, `DIM=1024` |
| **Mail** (`MAIL_PROVIDER`) | `MAIL_DRIVER`, `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM`, `LOCAL_MAIL_DIR` | `local` (writes `.mail-outbox/`) → `postmark` (set the token) |
| **Demo replies** | `SIMULATE_REPLIES` | `false` → `true` auto-generates a provider reply after each send |
| **Inbound webhook** | `WEBHOOK_INBOUND_USER`, `WEBHOOK_INBOUND_PASS` | basic-auth on `POST /api/comms/inbound` |
| **Auth** | `AUTH_VERIFIER`, `GOOGLE_CLIENT_ID`/`_SECRET`/`_REDIRECT_URI`, `ADMIN_EMAILS`/`ADMIN_DOMAIN`, `SESSION_SECRET` | `stub` → `google` (auto when `GOOGLE_CLIENT_ID` set). Frontend uses `VITE_GOOGLE_CLIENT_ID`. |
| **Reuse** | `REUSE_ENABLED`, `REUSE_SIMILARITY_THRESHOLD`, `REUSE_RADIUS_METERS`, `REUSE_FRESHNESS_DAYS` | enabled; `0.15` / `50000m` / `90d` |
| **Compliance** | `COMPLIANCE_FAIL_MODE`, `COMPLIANCE_BORDERLINE_{LOW,HIGH}` | open on fallback; `0.4`/`0.7` |
| **Stage resilience** | `STAGE_LEASE_MS`, `REAPER_INTERVAL_MS`, `STAGE_MAX_ATTEMPTS` | `30000` / `10000` / `3` |
| **Notifications** | `REMINDER_LEAD_HOURS`, `REMINDER_SWEEP_INTERVAL_MS` | `24` / `60000` |
| **Pricing** (cost endpoint) | `PRICE_TABLE_JSON` | built-in table (local model = $0) |
| **Credits** (HP-19) | `REPORT_COST_CREDITS` | `1` credit per report run (reserve→charge/refund) |

## Worked example (real output)

A full run on the keyless demo. Responses below are **actual captured output** (options trimmed to 2).

```bash
# 0) Sign in (HP-19: intake is authenticated + credit-gated). On the keyless demo
#    use the stub verifier; an admin grants credits first.
ALICE=$(curl -s -X POST localhost:4000/api/auth/google -H 'content-type: application/json' \
  -d '{"idToken":"stub:alice@example.com"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
# admin tops up alice (needs her customer id from POST /auth/google → customer.id):
# curl -X POST localhost:4000/api/admin/customers/<alice-id>/credits -H "authorization: Bearer $ADMIN" -d '{"amount":5}'

# 1) Create an inquiry (authenticated; reserves 1 credit — 402 CREDITS_INSUFFICIENT if short)
curl -s -X POST localhost:4000/api/inquiries \
  -H 'content-type: application/json' -H "authorization: Bearer $ALICE" \
  -d '{"rawRequest":"A refurbished espresso machine for a small cafe in Lisbon, under EUR 1500."}'
```
```json
{ "id": "cmqy6shy20002nyx04tsoi1r6", "state": "RECEIVED",
  "workflowVersionId": "cmqy6rqnw000mzxw42srqv2oh", "customerEmail": "alice@example.com", "...": "…" }
```

```bash
# 2) Fetch the questionnaire by its capability token (the link emailed to the customer)
curl -s localhost:4000/api/q/<questionnaire-token>
```
```json
{ "inquiryId": "cmqy6shy20002nyx04tsoi1r6", "confirmed": false,
  "questions": [
    { "id": "confirm", "type": "confirm", "prompt": "Is this what you are looking for?" },
    { "id": "budget",  "type": "text",    "prompt": "Whats your budget range?" },
    { "id": "where",   "type": "text",    "prompt": "Preferred location / radius?" },
    { "id": "when",    "type": "text",    "prompt": "By when do you need it?" }
  ], "expiresAt": "2026-07-01T19:33:28.960Z" }
```

```bash
# 3) Confirm scope → the pipeline starts researching + reaching out
curl -s -X POST localhost:4000/api/q/<questionnaire-token> -H 'content-type: application/json' \
  -d '{"confirmedSubject":true,"answers":{"budget":"1500 EUR","city":"Lisbon"}}'
# → {"ok":true}

# 4) Watch it live: WebSocket (Socket.IO at /socket.io) or poll the live report
curl -s localhost:4000/api/inquiries/cmqy6shy20002nyx04tsoi1r6/report-live
```

```bash
# 5) When state = REPORT_DELIVERED, fetch the report by its token (public, no login)
curl -s localhost:4000/api/reports/<report-token>
```
```json
{
  "inquiryId": "cmqy6shy20002nyx04tsoi1r6",
  "token": "c4a65aea4a3c372f5993f9757ad4bf9ba6a9b75b",
  "summary": "Found 4 qualified options, ranked by quality + price.",
  "options": [
    { "subjectProvider": "Subject Provider 3", "price": 343, "currency": "EUR",
      "score": 0.838, "priceScore": 1.0, "qualityScore": 0.73,
      "availability": "in stock", "leadTime": "1-2w",
      "background": { "rating": 4.8, "reviewsCount": 258, "eligibility": "eligible",
                      "redFlags": [], "sources": ["model-derived (no live ratings source configured)"] } },
    { "subjectProvider": "Subject Provider 2", "price": 420, "currency": "EUR",
      "score": 0.785, "priceScore": 0.882, "qualityScore": 0.72,
      "availability": "in stock", "leadTime": "1-2w",
      "background": { "rating": 4.7, "reviewsCount": 257, "eligibility": "eligible", "redFlags": [] } }
  ],
  "timeline": { "generatedAt": "2026-06-28T19:33:54.928Z" }, "reusedFrom": null
}
```

**Shareable live report deep link** (no login, updates in real time):
`http://localhost:5173/#/r/<report-token>`

```bash
# 6) Admin-gated cost of the report (sign in first; operator-only — never in the customer payload)
TOKEN=$(curl -s -X POST localhost:4000/api/auth/google -H 'content-type: application/json' \
  -d '{"idToken":"stub:ops@monkeycode.io"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s localhost:4000/api/inquiries/cmqy6shy20002nyx04tsoi1r6/cost -H "authorization: Bearer $TOKEN"
```
```json
{ "currency": "USD", "perModel": [],
  "outreach": { "emails": 4, "replies": 4, "discovery": 1, "research": 4, "embeddings": 1, "estUsd": 0 },
  "tokenTotal": 0, "grandTotalUsd": 0 }
```
*(`perModel`/`tokenTotal` are 0 on the keyless demo — the local model is priced at $0 and no cloud tokens were spent.)*

## API surface

Global prefix `/api`. Full interactive reference at **`/api/docs`**.

| Surface | Routes |
|---|---|
| **Public** | `GET /inquiries/:id/report-live`, `GET /health` |
| **Capability-token** (no login) | `GET\|POST /q/:token`, `GET /reports/:token` |
| **Auth** | `POST /auth/google`, `GET /auth/me`, `GET /me/credits` |
| **Owner/admin** (Bearer, ownership-scoped) | `POST /inquiries` (credit-gated), `GET /inquiries`, `GET /inquiries/:id`, `GET /inquiries/:id/cost`, `POST /inquiries/:id/{cancel,pause,resume}`, `GET /comms/thread/:subtaskId` |
| **Admin** | `POST /admin/customers/:id/credits`, `GET /workflows`, `GET /workflows/:id`, `GET /workflows/:id/diff`, `POST /workflows/:id/publish`, `GET /audit` |
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
- `frontend/` React app — customer view + admin live board
- `packages/shared/` shared TypeScript types (events, workflow, enums, DTOs)
- `db/` Postgres image (PostGIS + pgvector); `docker/` production image Dockerfiles
- `backend/prisma/` schema, `sql/init.sql` (extensions + NOTIFY trigger), `seed.ts`

## More

- **Architecture & rationale:** [DESIGN.md](DESIGN.md)
- **API reference:** `/api/docs` (Swagger, served by the running backend)
- **Feature handovers / decisions:** [Notion — inqi space](https://app.notion.com/p/38dab80b77f281518161cd9333bc2fbf) · [Handover Prompts](https://app.notion.com/p/38dab80b77f28115afd5e239e83fecb2)

## Status

HP-01 → HP-17 implemented and verified: schema, versioned workflow engine + v1/v2 seed,
realtime event plumbing, intake/questionnaire/compliance, the AI research + outreach
pipeline, prior-report reuse, live reports (customer + admin), auth (Google + stub),
operator controls, workflow-version management, audit trail, notifications, per-report
cost accounting, frontend polish (deep link + Google sign-in), and hermetic CI/CD.
Real cloud deploy and live AI/email providers are left as documented stubs/seams.

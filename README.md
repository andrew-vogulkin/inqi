# inqi

AI-driven inquiry & research workflow. A customer asks for an item/service/rental/
org/trade; AI agents pre-research and vet it, confirm scope via a questionnaire,
fan out to providers (email), and return a cost & constraints report — live.

See **DESIGN.md** for the full architecture.

## Stack
NestJS · Postgres (only: data + pgvector + PostGIS + pg-boss queue + LISTEN/NOTIFY) ·
Socket.IO realtime · React + Vite · Qwen (DashScope) for AI.

## Quick start
```bash
cp .env.example .env          # add your QWEN_API_KEY
pnpm install
docker compose up -d db       # Postgres
pnpm db:migrate               # create schema
pnpm db:seed                  # install workflow v1 + demo data
pnpm dev                      # backend :4000  +  frontend :5173
```

## Layout
- `backend/`  NestJS API, workflow engine, pg-boss agent workers, WS gateway
- `frontend/` React app — customer view + admin live board
- `packages/shared/` shared TypeScript types (events, workflow, DTOs)

## Status
Scaffold: schema, versioned workflow engine + v1 seed, realtime event plumbing,
intake/questionnaire REST, stub agent workers emitting realistic events, both
frontend views wired to the live feed. AI prompts, real email outreach, and
prior-report reuse are stubbed with clear TODOs (see DESIGN.md §8).

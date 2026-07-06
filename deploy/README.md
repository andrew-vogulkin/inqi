# inqi — Alibaba Cloud production deployment runbook

Deploys the full stack to a **single Alibaba Cloud ECS** with Docker Compose:
Caddy (TLS front door) → nginx SPA + NestJS backend + Postgres (pgvector/PostGIS),
with **Qwen Cloud (DashScope)** as the model and **Postmark** for real email.

This is a **config + infra** job, not a code change — the app already defaults to
`AI_DRIVER=qwen_cloud` and ships a production Postmark path. What lives here:

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | The prod stack (caddy, frontend, backend, db) |
| `Caddyfile` | Same-origin routing + auto-TLS |
| `nginx-spa.conf` | SPA deep-link fallback for the frontend image |
| `.env.production.example` | Every var a go-live needs → copy to `deploy/.env` |

**Decisions baked in:** Postgres runs as an on-box container (not managed RDS);
the backend image installs Chromium (depth `open_url` works); web search reaches
the home-lab SearXNG over **Tailscale** (the ECS host joins the tailnet).

---

## Prerequisites (you do these in the consoles)

1. **Alibaba region = Singapore `ap-southeast-1`** (international). This co-locates
   with DashScope INTL *and avoids mainland-China ICP filing*, which a public domain
   on a Beijing/Hangzhou ECS legally requires. Do **not** pick a mainland region.
2. **ECS**: Ubuntu 22.04/24.04, 2 vCPU / 4 GB (min), a public IP. Install Docker +
   compose plugin. Security group inbound: **22** (your IP only), **80**, **443**.
3. **DashScope / Model Studio**: create an API key. Confirm whether your workspace
   uses the generic INTL base URL or a workspace-scoped `…maas.aliyuncs.com` one.
4. **DNS (Porkbun)**: you'll add the `A` record in Phase 5 once the box has an IP.
5. **Postmark**: server token + verified sender (`marlowe.v@monkeycode.io`) already
   done; inbound MX (`inqi-postmark-reply.monkeycode.io`) already live.

---

## Phase 1 — Images

CI (`.github/workflows/release.yml`) builds & pushes `inqi-backend` + `inqi-frontend`
to GHCR on push to a release tag/main. Either use those GHCR refs, or mirror to
Alibaba **ACR** for faster in-region pulls. Put the chosen refs in `deploy/.env`
(`INQI_BACKEND_IMAGE` / `INQI_FRONTEND_IMAGE`).

> The `db` image builds locally from `db/Dockerfile` on first `compose up` — no push
> needed. If you prefer, pre-build and tag it as `INQI_DB_IMAGE`.

## Phase 2 — Join the ECS host to Tailscale (for web search)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # authenticate; approve the node in the admin console
tailscale status | grep orange   # confirm orange is reachable
# sanity: the backend will hit this over the tailnet
curl -sk https://orange.tail035fe2.ts.net:8443 >/dev/null && echo "searxng reachable"
```

The compose file pins `orange.tail035fe2.ts.net` → `100.94.153.122` via `extra_hosts`
so the **backend container** resolves it (containers don't get MagicDNS). If orange's
tailnet IP changes, update that line in `docker-compose.prod.yml`.

## Phase 3 — Configure

```bash
cd deploy
cp .env.production.example .env
# fill: POSTGRES_PASSWORD, DATABASE_URL (same pw), SESSION_SECRET (openssl rand -hex 32),
#       QWEN_API_KEY, POSTMARK_SERVER_TOKEN, WEBHOOK_INBOUND_USER/PASS, image refs, domain.
chmod 600 .env
```

## Phase 4 — First deploy + DB init

```bash
docker compose -f docker-compose.prod.yml pull            # backend/frontend
docker compose -f docker-compose.prod.yml up -d db        # start Postgres first
# Initialise schema (no migrations dir — schema-first push), then extensions, then seed:
docker compose -f docker-compose.prod.yml run --rm backend \
  sh -lc 'cd backend && pnpm exec prisma db push'
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U inqi -d inqi < ../backend/prisma/sql/init.sql
docker compose -f docker-compose.prod.yml run --rm backend \
  sh -lc 'cd backend && pnpm exec tsx prisma/seed.ts'
# Bring up the rest:
docker compose -f docker-compose.prod.yml up -d
```

`prisma db push` re-runs are safe; `init.sql` is idempotent (`IF NOT EXISTS`). pg-boss
self-initialises its schema on backend boot. Promote your admin account once:
`docker compose … exec backend sh -lc 'cd backend && pnpm db:promote-admin andrei@monkeycode.io'`.

## Phase 5 — DNS + TLS

Add the A record so Caddy can issue a cert:

```
A   inqi   <ECS-public-IP>     # → inqi.monkeycode.io
```

Once it resolves, Caddy obtains the LE cert automatically. Verify:

```bash
curl -sS https://inqi.monkeycode.io/api/docs -o /dev/null -w '%{http_code}\n'   # 200
```

## Phase 6 — Postmark inbound webhook

Postmark → Servers → (server) → **Inbound** → Settings:
- **Inbound domain forwarding**: `inqi-postmark-reply.monkeycode.io`
- **Webhook URL**: `https://inqi:<WEBHOOK_INBOUND_PASS>@inqi.monkeycode.io/api/comms/inbound`
  (HTTP Basic — must match `WEBHOOK_INBOUND_USER`/`PASS` in `.env`)

Confirm the DKIM row on the sender signature is verified (Return-Path already is).

## Phase 7 — Production smoke test (real email, no simulation)

With `SIMULATE_REPLIES=false`:
1. Sign in, submit a report whose outreach will email a **mailbox you control** as
   the "subject provider" (so you can reply for real).
2. Watch outbound land (Postmark Activity) and the report reach `OUTREACH`.
3. Reply from that mailbox → Postmark inbound POSTs `/api/comms/inbound` → the report
   re-evaluates and the dossier refreshes.
4. Confirm the model is DashScope: `docker compose … logs backend | grep -i qwen`,
   and the usage ledger shows cloud token costs.

---

## Verify a model/mail swap without redeploying

Both are pure env — change `deploy/.env` then `docker compose … up -d backend`:
- **Model**: `QWEN_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL*` (OpenAI-compatible; no code).
- **Mail**: `MAIL_DRIVER`, `POSTMARK_*`, `SIMULATE_REPLIES`.

## Known gotchas

- **Depth browser**: the backend image now runs `playwright install --with-deps
  chromium`; the build is heavier and needs a couple hundred MB. If a `run --rm`
  step OOMs on a tiny box, give the ECS ≥4 GB.
- **Tailscale + containers**: only the *host* is on the tailnet; the backend reaches
  orange via the `extra_hosts` IP pin, not MagicDNS. This couples cloud web-search
  uptime to the home lab — acceptable per the deploy decision, revisit if orange
  goes down often.
- **CORS**: `WEB_ORIGIN` must include the exact `https://inqi.monkeycode.io` origin.
- **Secrets**: `deploy/.env` is git-ignored; for real hardening move to Alibaba
  Secrets Manager (Phase 8, post go-live).

## Post-go-live hardening (Phase 8)

Secrets Manager, automated `inqi_pg` volume snapshots/backups, log + uptime
monitoring, and wiring the stubbed deploy job in `release.yml` for push-button CD.

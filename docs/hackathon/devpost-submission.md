# Devpost submission — field-by-field

> Fill Devpost top-to-bottom from this file. Everything is final except the two
> [BRACKETED] placeholders.

## Track

**Autopilot Agent**

## Project name & tagline

- Name: **inqi**
- Tagline: *One report. AI agents on it. Customer inquiry → vendor discovery →
  real email outreach → negotiated replies → ranked quotes. Unattended — and
  self-improving.*

## Code repository (public, OSI license)

```
https://github.com/andrew-vogulkin/inqi
```

- License: **AGPL-3.0** at the repo root — GitHub auto-detects it; after the repo
  is public, confirm "AGPL-3.0 license" shows in the **About** sidebar (that's
  what judges check).
- Setup instructions + env examples: root `README.md` ("Run it locally") and
  `.env.example`. The keyless demo runs with no API keys at all.

## Proof of Alibaba Cloud deployment

Paste these links (code files demonstrating Alibaba Cloud services/APIs):

- Qwen Cloud (DashScope) endpoint constant — the whole AI layer points at
  Alibaba's API:
  `https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/infra/config/config.service.ts#L13`
- The OpenAI-compatible DashScope client (every model call in the pipeline):
  `https://github.com/andrew-vogulkin/inqi/blob/main/backend/src/infra/ai/qwen-provider.base.ts`
- Production deployment on Alibaba Cloud ECS (Docker Compose + Caddy + runbook):
  `https://github.com/andrew-vogulkin/inqi/blob/main/deploy/docker-compose.prod.yml`
- Plus: a screenshot of the ECS console showing the running instance
  (Singapore region) — attach as an image. [SCREENSHOT — grab from your
  Alibaba Cloud console]

## Architecture diagram

Upload both PNGs (also embedded at the top of the repo README):

- `docs/hackathon/inqi-architecture-infra.png` — infra: customer/vendors →
  Caddy → SPA + NestJS on one ECS instance (Postgres, SearXNG on-box) →
  Qwen Cloud / Serper / Postmark, with the outreach + inbound-webhook loop.
- `docs/hackathon/inqi-architecture-flow.png` — the agent pipeline: request →
  pre-research → breadth discovery → funnel → parallel depth research +
  outreach/reply loop → synthesis → delivered, plus the self-improvement loop
  (RUN → MEASURE → PROPOSE → REHEARSE → PUBLISH with auto-approve).

## Video

```
[YOUTUBE URL — public, playable without login]
```

Suggested YouTube title: **inqi — vendor sourcing on autopilot (Qwen Cloud ×
Alibaba Cloud)**
Suggested YouTube description: one plain request → autonomous research, real
email negotiation, and a ranked, evidenced report — for about fifty cents.
Built on Qwen Cloud (DashScope), deployed on Alibaba Cloud ECS.
https://inqi.monkeycode.io · https://github.com/andrew-vogulkin/inqi

## Text description

Paste `docs/hackathon/devpost-description.md` verbatim (it follows Devpost's
template: Inspiration / What it does / How we built it / Challenges /
Accomplishments / What we learned / What's next). Qwen Cloud is named in
"How we built it" and throughout.

## Built With (tags)

`qwen` · `alibaba-cloud` · `dashscope` · `typescript` · `nestjs` · `prisma` ·
`postgresql` · `pg-boss` · `react` · `vite` · `postmark` · `serper` · `docker` ·
`caddy`

## Try it out (links)

- Live app: `https://inqi.monkeycode.io` — sign up (email + code), get **10
  credits** automatically, run a report. Note for judges: after submitting a
  request, confirm the short scope questionnaire the agent sends — then it runs
  unattended to a delivered report (~15–25 min; the report page streams live
  progress and emails you when ready).
- Repo: `https://github.com/andrew-vogulkin/inqi`

## Team / eligibility

- All teammates accepted their Devpost project invites.
- Country of residence: eligible per the rules you checked. ✔︎

## Optional — Blog Post Prize

Eligible only with a published blog/social post about building with Qwen Cloud.
If you write one (X/LinkedIn/Medium), add its URL here: [BLOG URL or skip]

## Final pre-submit checks (from Devpost's email)

- [ ] Repo public + AGPL-3.0 visible in About sidebar
- [ ] Alibaba Cloud proof links above pasted + ECS screenshot attached
- [ ] Both architecture PNGs uploaded
- [ ] Video on YouTube, **public**, plays in incognito
- [ ] Track = Autopilot Agent selected
- [ ] Description pasted, Qwen Cloud named in text AND Built-With tags
- [ ] Teammates accepted invites

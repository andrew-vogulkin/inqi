# Source lifecycle, subentities & organisation

A **Source** is one typed channel record under an Inquiry — where a piece of
evidence or a conversation lives. Source of truth:
`packages/shared/src/enums.ts` (`SourceType`, `ConvState`),
`backend/prisma/schema.prisma` (`Source`, `Message`),
`backend/src/domain/source` (`SourcesService`, `EmailChannelService`, mail
providers).

## The two families

| Family | Types | Shape | Subentities |
|---|---|---|---|
| **Flat** (evidence pages) | `websearch`, `rating_feedback` | `url` + `title` + `snippet` (+ `data` JSON) | none |
| **Thread** (conversations) | `email`, `whatsapp` (future) | `replyAddress` (unique), `convState`, `lastInboundAt` | `Message[]` |

### Organisation & constraints

- `@@unique([inquiryId, type, url])` — flat sources **upsert**: re-finding the
  same page (discovery evidence, then depth research citing it again) dedupes
  into one row.
- `@@index([inquiryId, type])` — everything is read per-inquiry, per-channel.
- **Budget**: `SOURCES_MAX_PER_INQUIRY` (default 5) flat+thread rows per
  inquiry, of which **one slot is always reserved for the email thread** and
  one is kept for the rating digest; depth research fills the remaining web
  slots with its cited proof pages.
- The **rating digest** is a `rating_feedback` source with a stable pseudo-URL
  (`ratings:<name>`) so re-research upserts instead of duplicating; its `data`
  carries the full background verdict (rating, reviewsCount, sentiment, themes,
  quotes).

## Flat-source lifecycle

```
created (upsert) ──▶ cited by dossier/provenance ──▶ superseded only by upsert
```
Written from three places, all in the owning transaction and all emitting
`source.added` (with what-was-added detail for the activity feed):
1. `build_funnel` — breadth-discovery evidence urls,
2. `research_background` — the depth agent's cited pages + the rating digest,
3. never by hand — the customer-visible dossier is proof-driven.

## Thread-source (email) lifecycle

```
ensureEmailThread (outreach_inquiry)          one Source per inquiry thread,
  │  unique replyAddress minted               idempotent
  ▼
outbound Message (draft → compliance gate → sent)      persona-voiced
  ▼
convState: awaiting_reply  ──inbound──▶ Message(received) → process_reply
  │                                        │ parse: qualify | disqualify | continue
  │                                        ├ continue → follow-up Message, back to awaiting_reply
  │                                        └ qualify/disqualify → convState: closed
  │
  └── silent past REPLY_TIMEOUT_MINUTES ──▶ inquiry marked unresponsive,
      thread STAYS awaiting_reply (LONG-POLL) — a reply next week still lands,
      processes, and (if it changes scoring on a delivered report) triggers
      refresh_snapshot
```

- Inbound resolution: `POST /api/comms/inbound` (Postmark webhook, or the local
  driver's loopback) → `replyAddress` → Source → Inquiry → Report.
- ≤ 3 provider replies per thread are accepted in simulation
  (`REPLY_MAX_PER_THREAD`); real mode has no such cap.
- Mail transport is a seam (`MAIL_DRIVER`): `local` captures outbound to
  `backend/.mail-outbox` (nothing is delivered; `SIMULATE_REPLIES` optionally
  fakes provider replies — **off** by default now); `postmark` sends for real.

## Message subentity

One row per email in/out: `direction`, `status`
(`draft|sent|delivered|received|bounced`), RFC-5322 threading (`externalId`
unique, `inReplyTo`, `references[]` — also the idempotency key for inbound),
`parsed` JSON (extracted price/availability/intent), `personaId` author
denorm, and the compliance-gate verdict (`reviewStatus`, `riskScore`,
`riskTags`) — blocked drafts are kept for audit, never sent.

## Dependencies

- **Feeds**: the dossier (per-inquiry evidence + full email chain), provenance
  (`outreach.chain`), the 100k agent/report context (rating + web snippets +
  latest messages, round-robin packed), synthesis.
- **Fed by**: breadth discovery, depth research, outreach, inbound webhooks.
- **Events**: `source.added` (with source description), `message.sent`,
  `message.received` — all room-scoped to `report:{id}`.

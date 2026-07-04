# Inquiry lifecycle & dependencies

An **Inquiry** is one candidate under investigation for a report (e.g.
"Makara Yoga, Sukhumvit"). Up to 8 exist per report, grouped into an **Epic**
and released in escalating waves (1:3:9). Source of truth:
`packages/shared/src/enums.ts` (`InquiryStatus`), `backend/prisma/schema.prisma`
(`Inquiry`), `backend/src/domain/orchestrator` (waves/reactor),
`backend/src/domain/subject-providers` (depth research + settlement),
`backend/src/domain/agent` (reply processing).

## Data shape (prisma `Inquiry`)

- `reportId` (root FK) + `epicId` (wave orchestration), `wave` (1:3:9).
- `name` (candidate), `leadSource` (`ai | fallback`), `contact` JSON — discovered
  email/url plus **`matchNote`** when breadth discovery surfaced the candidate in
  a constraint-relaxing fallback round ("found without 'rooftop' — confirm via
  research/outreach").
- `status` (`InquiryStatus`), `result` JSON (price, availability, leadTime,
  notes or `disqualified` reason), `background` JSON + `qualityScore` (depth
  verdict), **`researchPending`** — true while a `research_background` job is
  queued/running; the synthesis gate and the UI in-progress chip read it.
- Children: `sources[]`, `messages[]` (see [Source lifecycle](source-lifecycle.md)).

## Statuses (8) and transitions

```
pending ──(research_background enqueued)──▶ researching
   │                                            │ depth verdict persists (researchPending=false)
   │                                            ├── eligible + score ≥ 0.35 ─▶ qualified ✓
   │                                            ├── "not eligible"           ─▶ failed ✕
   │                                            └── ambiguous ─▶ stays open, outreach decides
   │
   ├──(outreach_inquiry sent)──▶ contacted ──reply──▶ replied
   │                                │                    │ reply parse (DEPTH)
   │                                │                    ├─ qualify    ─▶ qualified ✓
   │                                │                    ├─ disqualify ─▶ failed ✕
   │                                │                    └─ continue   ─▶ follow-up sent, stays replied
   │                                │
   │                                └──silent past REPLY_TIMEOUT_MINUTES──▶ unresponsive ◌
   │                                        (thread stays OPEN — long-poll; a late
   │                                         reply still processes and re-evaluates)
   └──(epic stopped early, wave never sent)──▶ skipped ✕
```

Settled (counted done): `qualified`, `failed`, `skipped`. **`unresponsive` is
NOT failed** — it's excluded from the reactor's in-flight count so the funnel
moves on, but the email thread remains `awaiting_reply` forever (long-poll).

## The two settlement rules

1. **Research settles, email enriches** ("email never gates an inquiry"):
   the depth verdict alone settles the inquiry
   (`SubjectProvidersService.settleFromResearch`) — eligible + `qualityScore ≥
   0.35` → `qualified` with an Option finding whose price is **web-evidenced**
   (may be null, noted "awaiting provider confirmation"); a clear "not eligible"
   → `failed` with the reason. A provider reply arriving later **merges** into
   the existing Option finding ("confirmed by provider reply") — it is never a
   precondition for delivery.
2. **Any evidence that changes scoring on a delivered report re-evaluates it**:
   both a late depth verdict and a material reply enqueue `refresh_snapshot`
   (singleton per report) so the frozen snapshot re-ranks in place.

## The settlement reactor (`inquiry_settled`)

After every settlement the reactor asks: target met (5 qualified)? → finish
outreach. A wave still in flight? → wait. Otherwise release the next wave;
funnel dry? → **widen** discovery (re-run breadth search excluding known names,
still capped at 8 total inquiries).

## Dependencies

- **Created by**: `build_funnel` from breadth-discovery candidates
  ([breadth-search lifecycle](breadth-search-lifecycle.md)); evidence pages are
  stored immediately as websearch Sources.
- **Researched by**: `research_background`
  ([depth-search lifecycle](depth-search-lifecycle.md)) — writes `background`,
  `qualityScore`, a `SubjectProviderBackground` finding, cited websearch
  Sources + the rating digest, then settles per rule 1.
- **Contacted by**: `outreach_inquiry` — persona-voiced draft, compliance gate
  (blocked → `failed`, draft kept for audit), unique reply address per thread.
- **Read by**: the synthesis gate (`researchPending`), ranking (qualityScore +
  Option findings), the admin board and dossier (status, chain, spinner),
  provenance (`outreach.chain`, research-pending flag).
- **Events**: `inquiry.created` / `inquiry.updated` (status, score, reason,
  `name` for human-readable activity), `source.added`, `message.sent/received`.

# Depth-search lifecycle & dependencies

Depth research evaluates **one candidate** end-to-end: is it eligible for this
request, how good is it, what does it cost — with every claim backed by a cited
page. It runs as `research_background`, enqueued once per inquiry at funnel
build. Source of truth:
`backend/src/domain/subject-providers/subject-providers.service.ts`
(`investigate` + settlement), `depth-lifecycle.ts` (queries / lead pool /
evaluation gate), `background.prompt.ts` (schemas + prompt builders); spec:
`depth-lifecycle.spec.ts`.

## Lifecycle

```
A. CONTEXT      candidate name + region + what the customer is looking for
                + unconfirmedConstraint (matchNote from a breadth fallback find)
      ▼
B. QUERIES      the model forms ~5 TARGETED queries, one per angle:
                official site/booking · reviews & ratings · pricing per the
                request's unit · complaints/closure/red flags · a query that
                verifies the unconfirmed constraint (when present).
                Every query is anchored on the candidate name (+ city).
      ▼
C. SEARCH       all queries run concurrently; hits merge + dedupe into a lead
                pool (≤ DEPTH_MAX_LEADS = 12, snippets trimmed to 300 chars)
      ▼
D. AGENTIC      tool loop (web_search + open_url in a real browser, budget =
   INVESTIGATION DEPTH_AGENT_MAX_TOOLCALLS per cycle). Cycle 1 is SEEDED with
                the lead pool — the agent opens the most informative leads
                instead of re-searching blindly, and searches only for what
                the leads don't cover. Returns the strict-JSON verdict:
                rating, reviewsCount, sentiment, themes, quotes, eligibility
                ("eligible…"/"not eligible…"), redFlags, price + currency
                (web-evidenced), qualityScore, cited sources (real urls only)
      ▼
✓ E. EVALUATION a cheap audit (ModelTier.Balanced) of the verdict's EVIDENCE:
     GATE       · eligibility grounded in a cited page? constraint verified?
                · rating/reviews evidenced or genuinely unavailable?
                · price evidenced for the unit, or a booking page checked?
                · red flags actively looked for (empty = "looked, found none")?
                → { sufficient, gaps[] }
                sufficient (or out of cycles) → G;  insufficient ▼
F. TARGETED     fresh tool budget aimed at the gate's NAMED gaps first
   REFINE       ("price not evidenced — open the booking page"), then generic
  (≤ DEPTH_     hardening: cross-check ratings on an uncited source, hunt red
   AGENT_CYCLES) flags, drop what pages no longer support → back to E
      ▼
G. VERDICT      persisted in one transaction: inquiry.background + qualityScore
                (researchPending cleared), cited pages → websearch Sources,
                the rating digest, a SubjectProviderBackground finding,
                inquiry.updated — then SETTLEMENT (below)
```

## What the verdict does (settlement — "email never gates an inquiry")

- eligible + `qualityScore ≥ 0.35` → inquiry **qualified** with an Option
  finding: web-evidenced `price`/`currency` (may be null — "awaiting provider
  confirmation"); a later provider reply **merges** into this option.
- verdict starts "not eligible" → inquiry **failed** — allowed ONLY on
  **evidence of absence** (a page proving wrong location / closure / wrong
  service); "could not find it" never fails a candidate.
- "unverified" / ambiguous → left **open** for outreach / the reply-wait sweep;
  the summary says "couldn't verify yet", never "disqualified".

Depth **strengthens** the facts breadth collected (`knownFacts`: official
website, socials, verbatim price mentions) rather than re-verifying from
scratch — the work order is open the known site first, then a review page,
and only search for what the pages didn't answer.
- verdict lands **after delivery** → `refresh_snapshot` (singleton per report)
  re-ranks + re-synthesizes the frozen snapshot in place.

## Why the gate (vs. the old always-refine loop)

Previously every candidate got all `DEPTH_AGENT_CYCLES` refinement cycles,
regardless of need. The gate makes cycles **demand-driven**: a verdict whose
evidence already stands stops after cycle 1 (cheaper, faster past the
synthesis gate), while a thin verdict buys another cycle aimed at the exact
shortfalls instead of a generic re-read — the same
find → evaluate → escalate shape as breadth's conversion checkpoint.

## Degradation ladder

| Failure | Behaviour |
|---|---|
| Query formation fails | naive "name + region" query |
| A search call fails | that query contributes nothing; empty pool is fine (the agent searches itself) |
| Agent cycle fails, no verdict yet | next cycle retries from scratch |
| Agent cycle fails, verdict in hand | prior verdict stands (never degraded) |
| Evaluation gate fails | treated as **sufficient** — a broken auditor must not burn cycles |
| AI unconfigured | one direct web search + deterministic stub scoring |

## Dependencies

- **Seams**: `AI_PROVIDER` (`toolStructured`, `ModelTier.Depth`; queries run
  `Breadth`, the gate `Balanced`), `WEB_SEARCH`, `PAGE_READER` (real-browser
  `open_url`).
- **Inputs**: `Inquiry.contact.matchNote` → `unconfirmedConstraint`, the
  enriched `Subject`, the per-inquiry source budget
  (`SOURCES_MAX_PER_INQUIRY`, 1 slot reserved for email + 1 for the rating
  digest).
- **Outputs**: inquiry `background`/`qualityScore`/`researchPending=false`,
  websearch + rating_feedback `Source` rows, `SubjectProviderBackground` +
  (on qualify) `Option` findings, `inquiry.updated`, settlement +
  `inquiry_settled`, possibly `refresh_snapshot`.
- **Read by**: the synthesis gate (blocks delivery while `researchPending`),
  ranking, the dossier ("Public feedback score" / "Price score"), provenance.

## Tunables

`DEPTH_AGENT_CYCLES` (default **150** — a hard CAP, not a target: the gate
drives actual usage; sufficient evidence stops after cycle 1, and the SAME gaps
twice in a row stops as stalled — the evidence isn't publicly out there),
`DEPTH_AGENT_MAX_TOOLCALLS` (default 6, per cycle), `DEPTH_MAX_LEADS = 12`
(constant), `SOURCES_MAX_PER_INQUIRY` (default 5).

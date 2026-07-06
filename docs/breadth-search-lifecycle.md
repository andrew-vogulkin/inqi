# Breadth-search lifecycle & dependencies

Breadth search fills the funnel: given the enriched subject, find up to 8 real
candidate providers with evidence. It runs inside `build_funnel` and again on
**widening** (funnel dry, target unmet). Source of truth:
`backend/src/domain/subject-providers/ai-discovery.source.ts` (+
`discovery.prompt.ts`, `infra/ai/prompts.ts`); spec:
`ai-discovery.source.spec.ts`.

## Lifecycle

```
A. CONTEXT      subject title + description + confirmed questionnaire answers
                + names to exclude (widening passes prior finds)
      ▼
B. QUERIES      the model forms 5 DIVERSE, SERVICE-FIRST queries
                ("rooftop yoga class Bangkok", not "rooftop Bangkok")
      ▼
C. SEARCH       all queries run concurrently against SearXNG; hits merge +
                dedupe by url into one pool (≤ MAX_WEB_HITS = 24)
      ▼
D. MINE         relevance-gated proposal over the pool: a candidate qualifies
                ONLY if it plausibly PROVIDES the subject (a rooftop BAR does
                not provide rooftop yoga); evidence = urls that really came
                back (invented urls are stripped). Each candidate STORES THE
                FACTS seen: website, socials, verbatim price/address mentions
                — depth research strengthens these later. EVIDENCE FLOOR:
                with a non-empty pool, a candidate grounded in nothing
                (no evidence url, no website) is dropped as a hallucination
      ▼
E. QUALIFY      cheap filter pass drops setting/keyword look-alikes;
                FAIL-OPEN — a filter hiccup never empties the funnel
      ▼
✓ CHECKPOINT    qualified ≥ count × MIN_CONVERSION (0.5)?  yes → G
      │ no
      ▼
F. FALLBACK     the model relaxes the LEAST-essential constraint and re-forms
  (≤2 rounds)   queries ("rooftop yoga studio" → "yoga studio"); NEVER drops
                the service or the location; returns { relaxed, queries } →
                back to C. Fallback finds carry
                matchNote: "found without 'rooftop' — confirm via research/outreach"
      ▼
G. OUTPUT       { candidates (full-match first, capped at count), notes }
                notes ("search converted 1/8 — relaxed 'rooftop'…") land in
                Agent activity
```

## Why each gate exists

- **Relevance gate (D)** — SERP results match keywords/settings, not services;
  without it a "rooftop yoga" request funnels rooftop bars.
- **Qualification filter (E)** — the miner is generous under a count target; a
  second cheap look at the evidence snippets catches what slipped through.
- **Conversion checkpoint + fallback (F)** — an over-constrained request would
  otherwise ship a starving funnel; relaxation trades precision for recall
  **explicitly**, and the traded dimension travels on the inquiry
  (`contact.matchNote`) so depth research and outreach must confirm it before
  the candidate ranks as a full answer.

## Degradation ladder

| Failure | Behaviour |
|---|---|
| Query formation fails | naive single query (title + description) |
| A search backend call fails | that query contributes nothing (best-effort per query) |
| Mining call fails | round logged, loop continues |
| Filter fails / returns empty | fail-open to the proposed set |
| Fallback formation fails | ship what was found |
| Nothing found at all / AI unconfigured | deterministic `Subject Provider N` fallback names |

## Dependencies

- **Seams**: `AI_PROVIDER` (structured calls, `ModelTier.Breadth`; the filter
  runs `Balanced`), `WEB_SEARCH` (SearXNG), bound behind `DISCOVERY_SOURCE`.
- **Callers**: `build_funnel` (initial) and the settlement reactor's widening
  path (passes `exclude` = every name already tried; total inquiries capped
  at `BREADTH_MAX_INQUIRIES` = 8).
- **Outputs**: `Inquiry` rows (with `leadSource`, `contact.matchNote`),
  websearch `Source` rows from evidence, `Discovery: …` activity events.
- **Downstream**: [depth-search lifecycle](depth-search-lifecycle.md) receives
  `matchNote` as `unconfirmedConstraint` and must verify the relaxed dimension.

## Tunables

`MAX_WEB_HITS = 24`, `MAX_DRY_ROUNDS = 2` (constants in
`ai-discovery.source.ts`); **`BREADTH_MAX_CYCLES` (default 50)** — the hard cap
on the adaptive loop (which presses toward the full funnel target and stops on
2 dry rounds or unchanged queries); funnel size via `BREADTH_MAX_INQUIRIES`.

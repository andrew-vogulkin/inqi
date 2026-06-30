# inqi — Frontend Page Spec

A page-by-page reference for the inqi prototype (`Inqi Prototype.dc.html`). One app, two areas: **Customer** (responsive, mobile-first) and **Admin / Operator** (desktop-first). The left navigator rail is prototype chrome only — not part of the shipped product.

The frontend is a **pure view over events + DTOs** (no business logic). Reads are synchronous (`GET` / `POST` that return a result); "run" actions return fast and stream effects over **WebSocket** (Socket.IO, replay-by-cursor). Customers subscribe to `inquiry:{id}`; admins to the `admin` room.

Legend: **[btn]** button · **[input]** text field · **[filter]** filter/toggle · **[link]** navigation link.

---

## CUSTOMER AREA

### 1. Sign in
**Description:** Entry screen for an anonymous visitor. Brand statement + single Google sign-in.

**Live elements**
- **[btn] Continue with Google** → `POST /auth/google`; signing-in spinner → authenticated → Dashboard.
- Footer note: "First report is free. No card required."

**Data sources**
- Write: `POST /auth/google` → session/token.
- None read (pre-auth).

**Conditional validation**
- States: `signed-out` → `signing-in` (button busy) → `error` (re-enable + message). App-wide **401** returns here.

**Subpages / subcompositions** — none.

---

### 2. Dashboard
**Description:** Authenticated home. The customer's own inquiries with a 6-stage status pipeline; credit balance.

**Live elements**
- **[btn] {N} credits** → Credits page.
- **[btn] New inquiry** → New inquiry.
- **[link] Inquiry row** → routes by stage (Researching → Live report streaming; Ready → Live report final; Partially ready → Freemium teaser; Questionnaire/Draft → Questionnaire).
- Per row: stage pipeline (6 segments) + status badge + meta.

**Data sources**
- Read: `GET /inquiries` (owner-scoped list; each item: id, ref, title, stage, status, updatedAt).
- Read: `GET /me/credits` (balance).
- Live: `inquiry.created` / `inquiry.transitioned` → update row stage/state.

**Conditional validation**
- **Empty** (no inquiries) → first-run CTA. **Populated** → card list.
- Stages: `Draft → Preparing → Questionnaire → Researching → Partially ready → Ready`; Researching/Preparing show a live pulse.
- Owner-scoped only (no others' inquiries; **404** rather than existence leak).

**Subpages / subcompositions** — Inquiry card (pipeline + badge) · Empty-state composition.

---

### 3. New inquiry
**Description:** Free-text request capture, credit-gated. Reserves 1 credit on submit.

**Live elements**
- **[input] Request textarea**.
- Suggestion tags — Service · Near me · Budget set · Flexible timing · **Photo upload (SOON, disabled)**.
- **[btn] Start research →** → reserve credit → Questionnaire.

**Data sources**
- Read: `GET /me/credits` (live available balance in the reserve hint).
- Write (async): `POST /inquiries` → `201 { inquiryId }` (starts pipeline) **or** `402` insufficient credits.
- Then subscribe `inquiry:{id}` for progress.

**Conditional validation**
- **402 / insufficient** → amber banner + **[btn] Add credits** (→ Credits); submit blocked until balance > 0.
- Reserve hint: "Reserves 1 credit · {N} available".

**Subpages / subcompositions** — 402 add-credits banner (conditional).

---

### 4. Questionnaire  `/q/:token` (login-free, capability token)
**Description:** Scope confirmation. inqi shows a **pre-researched enrichment**, then a multi-section clarifying form to confirm before outreach.

**Live elements**
- Pre-research card — enriched interpretation + facet chips + "no credit yet".
- 3 sections: *Format & group* (format **[filter]**, group size **[input]**, length **[filter]**, guidance **[filter]**) · *Schedule & frequency* (days **[filter multi]**, time **[filter]**, frequency **[filter]**) · *Budget & location* (budget **[input]**, area **[input]**, max travel **[filter]**).
- **[input] "Anything else?" textarea**.
- **[filter] Confirm checkbox** · **[btn] Confirm & start research**.

**Data sources**
- Read: `GET /q/:token` → token validity + pre-research/enrichment payload + prefilled answers.
- Write (async): `POST /q/:token` → advances pipeline (enrich → broad research → funnel → outreach); opens Live report.

**Conditional validation**
- **Confirm gate:** submit disabled until checkbox ticked.
- Single-select vs multi-select (days) filters.
- **Token states:** `open` · `submitted` (success) · `expired/invalid` (friendly recovery → Sign in).

**Subpages / subcompositions** — Pre-research card · 3 form-section cards · Submitted state · Expired/invalid state.

---

### 5. Live report  (owner view + `/r/:token` deep link, login-free)
**Description:** Centerpiece. Options stream in over WebSocket and re-rank live by **public feedback + price**, then settle to final. Three layout variations.

**Live elements**
- **[link] ‹ Dashboard** · **Status pill** (Researching live → Final).
- **[btn] Live · simulate reconnect** — "Reconnecting…" affordance → "no events missed" toast.
- **[filter] Layout switch** — List / Split / Table.
- **Agent activity (expandable)** — **[btn]** expands full step history.
- **Option rows** — rank, provider, price, feedback bar, availability, BEST MATCH on #1.
- **[link] How inqi researched this →** (per option) → Research dossier.

**Data sources**
- Read (snapshot): `GET /reports/:token` (or report snapshot for owner) → options[], timeline, status, reusedFrom.
- Live (`inquiry:{id}`): `finding.added` / `report.updated` → options appear + re-rank; `agent.*`, `epic.created`, `subtask.*`, `message.*` → aggregate progress; `report.ready` → final.
- Each option DTO: subjectProvider, price/currency, availability, leadTime, qualityScore (public-feedback), background, blended score.

**Conditional validation**
- Lifecycle: `empty → streaming (skeleton + ticking timeline) → final`. Never implies done while researching.
- Reconnect is non-blocking; events replay by cursor (no data loss).
- **Reused report** (`reusedFrom` set) → "From recent nearby research" banner + **[btn] Refresh**.
- Customer view shows aggregates only (no per-persona/provider operator detail).

**Subpages / subcompositions** — Layout A (cards) · B (split) · C (table) · Expandable activity history · Reused banner · Per-option → Research dossier.

---

### 6. Freemium teaser
**Description:** First report is free but reveals only the **#5-ranked** option; **top 4 locked**. The conversion surface.

**Live elements**
- Locked rows (×4) — redacted, no provider/contact leaked.
- **[btn] Unlock full report · 1 credit** — reveals all 5 + confirmation.
- Revealed option #5 (free taster).

**Data sources**
- Read: report snapshot with `freemium` flag (locked option set; only #5 detailed).
- Write (async): unlock/spend-credits action → charge credit → full report revealed (`report.updated`).
- Read: `GET /me/credits` (gates the unlock).

**Conditional validation**
- States: `locked` → `unlocked`. Unlock needs balance > 0; else "Not enough credits" toast.

**Subpages / subcompositions** — Locked stack · Unlock CTA · Revealed-option card · Unlocked full list.

---

### 7. Research dossier  (per provider; customer-facing)
**Description:** "How inqi researched this" as a full page — step-by-step provenance for one option. Reachable from Live report and the admin board.

**Live elements**
- **[link] Back** (adapts to origin) · header (provider, rank/price/feedback, depth badge, method badges).
- **Step 1 Web search** (sources + snippets) · **Step 2 Outreach** (persona, ✉ Email route, chain or empty state) · **Step 3 Feedback scan** (rating, sentiment bar, themes, quotes) · **Step 4 Qualification & ranking** (feedback/price/blended + rank).

**Data sources**
- Read: per-subtask research detail (web sources), `GET /comms/thread/:subtaskId` (outreach chain), feedback-scan summary, Finding/score record.
- Depth derived from which methods ran (web only · web+feedback · web+outreach+feedback).

**Conditional validation**
- Outreach step varies: replied → chain; pending → chain + awaiting note; not-contacted → public-listing note.

**Subpages / subcompositions** — 4 step cards.

---

### 8. Credits
**Description:** Balance + ledger; manual top-up request (early access).

**Live elements**
- Balance card · **[btn] Request a top-up** (→ toast) · Ledger rows.

**Data sources**
- Read: `GET /me/credits` → balance + ledger entries (debits/credits/refunds/welcome).
- Note: top-ups applied by an operator; **no realtime event** — refresh to see new balance.

**Conditional validation** — none (read + request action).

**Subpages / subcompositions** — Balance card · "Need more?" card · Ledger list.

---

### 9. Errors — 403 / 404
**Description:** Recovery screens.
- **403** "This area is for operators" → **[btn] Back to dashboard**.
- **404** "We can't find that inquiry" (no existence leak) → **[btn] Back to dashboard**.

**Data sources** — driven by the typed error envelope `{ error: { code, message, retryable, details } }` (403 / 404).

---

## ADMIN / OPERATOR CONSOLE

### 10. Live board  (Epics → Subtasks)
**Description:** Operational view of one inquiry, narrowing inquiry → **epics** → **subtasks**, with a live agent activity stream. Desktop-first.

**Live elements**
- **[filter] Inquiry tabs** · Epic cards (persona, progress, status dots, **"N need attention"** badge) **[link]** → epic detail · Agent activity stream.

**Data sources**
- Read: inquiry detail (`GET /inquiries/:id`) → epics[], subtasks[], findings[].
- Live (`admin` room): `epic.created`, `subtask.created/updated`, `finding.added`, `message.sent/received`, `wave.released`, `funnel.widened`, `agent.*`, `inquiry.transitioned`, `run.reaped`.

**Conditional validation**
- Toggles **epic list** ↔ **epic detail**. "Need attention" badge only when an epic has Suspended/Canceled/Error subtasks.

**Subpages / subcompositions**
- **Epic detail:** lineage **User request → Initial research → Confirmed scope (questionnaire) → Subtasks**; each subtask row **[link]** → Subtask system view.
- Subtask statuses: `Qualified · Contacted · Replied · Queued · Suspended · Canceled · Error`.
- Agent activity stream (right rail).

---

### 11. Subtask system view
**Description:** Dedicated admin/system page for one subtask (opened from the board).

**Live elements**
- **[link] ‹ Back to board** · header (provider, status, ref).
- **System score** (feedback/price/blended + rank; **[link] view research dossier →**) · **Outreach examination** (delivery meta, ✉ Email route, chain or status note) · **Status history** (transition timeline).

**Data sources**
- Read: subtask record (status, wave, persona/hub), Finding/score, `GET /comms/thread/:subtaskId` (chain + delivery meta), state-transition history.
- Live: `subtask.updated`, `message.sent/received`, `finding.added`.

**Conditional validation**
- Scored only when qualified; else "Not scored yet".
- Outreach block: chain when contacted/replied; status note for queued / suspended / canceled / error (550 bounce).
- History node colour follows current status (incl. negative endings).

**Subpages / subcompositions** — System score · Outreach examination · Status history · cross-link to Research dossier.

---

### 12. Run controls
**Description:** Pause / resume / cancel an in-flight inquiry; reflects state live; cancel refunds.

**Live elements**
- **[btn] Pause / Resume / Cancel & refund** (each via confirm dialog) · Settlement preview (in-flight jobs, credit on cancel, cost).

**Data sources**
- Write (async): `POST /inquiries/:id/{pause,resume,cancel}` → advance(signal); effects via `inquiry.paused/resumed/cancelled`.
- Read: `GET /inquiries/:id` (current run state) + `GET /inquiries/:id/cost` (settlement preview).

**Conditional validation**
- Button enablement by run state (Pause↔running, Resume↔paused, Cancel until cancelled).
- Confirm dialog required; **cancel → refund 1 credit** (live + toast).

**Subpages / subcompositions** — Confirm modal (shared) · Settlement preview.

---

### 13. Cost per report
**Description:** Admin-only cost rollup for one inquiry: per-model tokens + outreach → dollars.

**Live elements** — Summary tiles (total / LLM tokens / outreach) · line-item table.

**Data sources**
- Read: `GET /inquiries/:id/cost` → per-model token counts, outreach counts, dollar rollup.

**Conditional validation** — admin-only (**403** otherwise). Read view.

**Subpages / subcompositions** — Summary tiles · Line-item table.

---

### 14. Audit trail
**Description:** Every privileged action and denial — actor, target, time.

**Live elements**
- **[filter] Type chips** — All / Cancel / Pause / Resume / Publish / Top-up / Denials / Transitions · audit rows.

**Data sources**
- Read: `GET /audit?inquiryId=&types=` → entries (type, actor, target, timestamp).

**Conditional validation** — chip filters the query; "All" = unfiltered.

**Subpages / subcompositions** — Filter bar · Audit row list.

---

### 15. Workflow versions
**Description:** The inquiry state machine (14 states / 28 transitions) across workflow types. Type→version tree; diff; publish.

**Live elements**
- Workflow-type tree (Standard inquiry **DEFAULT**, Rental search, Local services, Goods & trade → versions w/ status + pinned counts).
- **[btn] View diff v7→v8** (toggle state machine ↔ diff) · **[btn] Publish v8** (confirm) · state-machine diagram + legend.

**Data sources**
- Read: `GET /workflows`, `GET /workflows/:id`, `GET /workflows/:id/diff`.
- Write: `POST /workflows/:id/publish` (transactional swap) → `workflow.published` → list refresh.

**Conditional validation**
- Right panel toggles state machine ↔ diff. Publish requires confirmation; in-flight inquiries stay pinned to their current version.

**Subpages / subcompositions** — Type→version tree · State-machine diagram · Diff view · Publish confirm modal.

---

### 16. Credit top-up  (operator)
**Description:** Manually add credits to a customer. Audited; **no realtime event** (customer refreshes).

**Live elements**
- **[input] Customer search** (name / email / ID) · result rows **[link]** select · **[btn] Change** · **[input] Amount** · **[input] Note (audited)** · **[btn] Add credits to {customer}**.

**Data sources**
- Read: customer directory/search (e.g. `GET /admin/customers?q=`).
- Write: `POST /admin/customers/:id/credits` (amount + note) → ledger entry; **no event** emitted.

**Conditional validation**
- Toggles **search/results** ↔ **selected-customer form**; "No customers match" empty state.
- Note: no realtime event — ask the customer to refresh.

**Subpages / subcompositions** — Search + results · Selected-customer form.

---

### 17. Outreach thread  (operator)
**Description:** The email conversation for one subtask, owned by a single persona.

**Live elements**
- **[link] ‹ Live board** · header (provider, persona + hub, ✉ Email route, status) · message bubbles (per-message address + timestamp).

**Data sources**
- Read: `GET /comms/thread/:subtaskId` → messages[] (direction, address, timestamp, body), persona owner.
- Live: `message.sent` / `message.received`.

**Conditional validation** — none (read view).

**Subpages / subcompositions** — Thread header · Message list.

---

## Cross-cutting

- **Auth:** signed-out / customer / admin · **401** → Sign in · **403** → forbidden · **404** → not-found (no existence leak).
- **Credits:** **402** insufficient → add-credits CTA · balance/ledger.
- **Realtime (WebSocket, replay-by-cursor):** skeletons, live pulse badges, streaming/re-ranking lists, non-blocking reconnect, event toasts. `topup` has **no event** (refresh balance).
- **Error envelope:** `{ error: { code, message, retryable, details } }` mapped to friendly, actionable messages.
- **Capability tokens:** invalid/expired questionnaire or report link → friendly recovery.
- **Empty / first-run** states on every list.
- **Tone:** calm, credible, "your AI is on it" — emphasise live progress and *why* an option is good (public feedback), not just price.

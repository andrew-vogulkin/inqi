# Report lifecycle & dependencies

The **Report** is the root entity: one customer request ("rooftop yoga class in
Bangkok tomorrow"), owning everything produced while answering it. Source of
truth: `packages/shared/src/workflow.ts` (states/events),
`backend/src/domain/report` (create/read), `backend/src/domain/orchestrator`
(stage jobs), `backend/src/domain/workflow` (engine).

## Data shape (prisma `Report`)

- Identity & scope: `customerEmail`, `customerId?` (linked on sign-in by verified
  email), `rawRequest`, geo (`geoLat/geoLng/geoLabel`), `budgetMin/Max`, `deadline`.
- Workflow: `state` (`ReportState`), `workflowVersionId` — **pinned**
  `WorkflowDefinition` version, so publishing a new workflow never re-routes an
  in-flight report; `cancelRequested`, `heldFromState` (operator pause/resume).
- `personaId` — **1:1 persona**: one of the 8 code-defined Inqi personas
  (`domain/agent/personas.ts`) picked at create via
  `pickPersona({ regionHint, requestText })` (geo label → request-text city
  tokens → random). Every outbound message of the report speaks in this voice.
- `freeReport` — freemium flag (snapshot delivered locked; unlock costs 1 credit).
- Children: `subject` (enriched need), `questionnaire`, `epics` (wave
  orchestration), `inquiries`, `snapshot` (the deliverable), `findings`,
  `agentRuns`, `usage`, `ledger`, `events`.

## Workflow states (14)

```
RECEIVED ──START_PRE_RESEARCH──▶ PRE_RESEARCH ──PRE_RESEARCH_DENIED──▶ DENIED ✕
                                     │ PRE_RESEARCH_PASSED
                                     ▼
                              QUESTIONNAIRE_SENT ──QUESTIONNAIRE_EXPIRED──▶ DROPPED ✕
                                     │ QUESTIONNAIRE_FILLED
                                     ▼
                                ENRICHMENT ──ENRICHMENT_DONE──▶ BROAD_RESEARCH
                                                                     │ BROAD_RESEARCH_DONE
                                     REUSE_FOUND (prior-report reuse)│
                                     ┌───────────────────────────────┤
                                     ▼                               ▼
                              REPORT_DELIVERED ✓ ◀──REPORT_READY── FUNNEL ──FUNNEL_BUILT──▶ OUTREACH
                                                                                  │ OUTREACH_DONE
                                                              REPORT_GENERATION ◀┘
Any processing state ──<stage>_FAILED / OUTREACH_STALLED──▶ FAILED ✕   (via the reaper)
Any state             ──CANCEL──▶ CANCELLED ✕   ──HOLD──▶ ON_HOLD ──RESUME──▶ heldFromState
```

Terminal: `DENIED`, `DROPPED`, `REPORT_DELIVERED`, `FAILED`, `CANCELLED`.
Processing (lease + heartbeat + reaper recovery): `PRE_RESEARCH`, `ENRICHMENT`,
`BROAD_RESEARCH`, `FUNNEL`, `OUTREACH`, `REPORT_GENERATION`.

Each state maps to a pg-boss job (`QueueJob`): `pre_research`,
`send_questionnaire`, `enrich_subject`, `broad_research`, `build_funnel`,
`start_outreach`, then per-inquiry fan-out (`outreach_inquiry`,
`research_background`, `process_reply`, `inquiry_settled`), and
`generate_report`. Transitions are seeded `WorkflowTransition` rows whose
`action` strings (`enqueue:<job>`) the engine executes after moving state.

## Customer-facing stage (derived, not a state)

`deriveStage` (`packages/shared/src/stage.ts`) projects state + qualified-count
into 7 stages: `Draft → Preparing → Questionnaire → Researching →
Partially ready (≥2 qualified) → Finalizing (≥5 qualified but NOT delivered) →
Ready (REPORT_DELIVERED only)`. **Finalizing exists so the UI never shows
"Ready" while depth research / synthesis is still wrapping up.**

## Delivery: the synthesis gate and the refresh loop

- `generate_report` runs `decideSynthesisGate` (`orchestrator/planning.ts`):
  while any non-settled inquiry has `researchPending`, the job re-enqueues
  itself (20 s × up to 90 polls ≈ 30 min) — options never ship with empty
  dossiers. Then: assemble findings → rank (quality + price) → DEPTH synthesis
  over the 100k report context → `ReportSnapshot` → `snapshot.ready` →
  `REPORT_READY` → `REPORT_DELIVERED`.
- An **empty report still gets an AI-written summary** explaining why nothing
  qualified (grounded in the failed inquiries' reasons/quotes) — and is never
  charged.
- **After delivery the report stays live**: a late depth verdict or a provider
  email that materially changes scoring enqueues `refresh_snapshot`
  (singleton-keyed `refresh:{reportId}` to coalesce bursts), which re-ranks and
  re-synthesizes the snapshot **in place**, stamps `timeline.refreshedAt`, emits
  `snapshot.updated` and sends the "report updated" email.

## Lifecycle events → customer notifications

`domain/report/report-lifecycle.ts` maps state changes to notification kinds;
dispatch happens centrally (workflow engine post-transition + refresh worker +
report intake for `created`, since RECEIVED has no inbound transition):

| Lifecycle event | Trigger | Notification |
|---|---|---|
| created | report intake | `report_received` ack |
| needs_you | QUESTIONNAIRE_SENT | `questionnaire_request` (capability link `/#/q/:token`) |
| delivered | REPORT_DELIVERED | `report_ready` — top-3 options + summary (withheld if freemium-locked) |
| updated | snapshot refresh | `report_updated` with the same detail block |
| denied | DENIED | `denial` with reason |
| dropped / failed / cancelled | terminal-bad | silent |

## Credits (pay-on-delivery)

Create only **checks** balance (or grants the freemium report) — no reserve.
The charge happens at `REPORT_DELIVERED` via `credits.settle('charge')`;
**a snapshot with 0 options is never charged**. Freemium unlock is a separate
1-credit `unlock` debit. Ledger kinds: `topup / reserve(legacy) / charge /
refund / unlock`; balance derivation is reportId-aware so legacy reserved
reports aren't double-charged.

## Dependencies

- **Reads**: pinned `WorkflowDefinition`, personas registry, customer balance.
- **Writes**: `EventOutbox` (→ Postgres NOTIFY → Socket.IO room `report:{id}`),
  `AgentRun` lease/heartbeat rows, `CreditLedger`, `ReportSnapshot`.
- **Reacted to by**: frontend dashboard/live report (typed events), the reaper
  (stuck processing states → `<stage>_FAILED`), notifications, kanban projection.
- **Downstream**: [Inquiry lifecycle](inquiry-lifecycle.md) (children),
  [Source lifecycle](source-lifecycle.md) (grandchildren).

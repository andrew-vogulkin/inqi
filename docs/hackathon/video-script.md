# inqi — demo video script (reel-style · fast cuts · ~1:16 total)

> Instagram-reel pacing: every scene is a SPEED-RAMPED burst (8–16×) with a
> 0.5–1 s hold on the one thing the viewer must register. Assertive VO, short
> declarative lines. On-screen captions mirror the VO's key words — most people
> watch muted first.
>
> Prerequisites (unchanged): qwen_cloud on (qwen3.6-plus) · Serper on ·
> SIMULATE_REPLIES=true, 2 rounds · workflow v3 (4 outreach threads) ·
> AUTOPILOT_QUESTIONNAIRE=false · signed in with credits · 125–150% browser
> zoom · 1080p+ capture. Record ONE full run (~15–25 min), then speed-cut.

---

## Timeline

| Beat | Clock | Scene | VO words |
|---|---|---|---|
| 0 | 0:00–0:08 | Title card (PPT slide 1) | ~20 |
| 1 | 0:08–0:11 | Dashboard → New report | ~7 |
| 2 | 0:11–0:16 | Prompt input | ~12 |
| 3 | 0:16–0:18 | Pre-research | ~5 |
| 4 | 0:18–0:28 | Questionnaire answer | ~25 |
| 5 | 0:28–0:40 | Research + first candidates | ~30 |
| 6 | 0:40–1:06 | The report (specifics) | ~62 |
| 7 | 1:06–1:16 | Close card | ~26 |

---

## Beat 0 · 0:00–0:08 — Title card

**VO:** "Vendor sourcing means hours of searching and email ping-pong. inqi
runs the whole loop autonomously — built on Qwen Cloud, deployed on Alibaba
Cloud."

**Screen:** title card (deck slide 1 export), full 8 s. Cut on the last word.

---

## Beat 1 · 0:08–0:11 — Dashboard → New report

**VO:** "One run, start to finish. New report."

**Screen:** dashboard 1.5 s (credits chip visible) → cursor clicks **New
report**. Caption: **ONE RUN · START TO FINISH**.

---

## Beat 2 · 0:11–0:16 — The prompt

**VO:** "Six hundred square meters of scaffolding, ten weeks, The Hague.
Focus: price."

**Screen:** typing sped to ~4 s:
`Scaffolding hire with assembly and dismantle, around 600 m2 facade, 10-week refurbishment in the The Hague area`
**Price** toggle flips → **Start research** on the last VO word.
Caption: **ONE PLAIN REQUEST**.

---

## Beat 3 · 0:16–0:18 — Pre-research

**VO:** "It scopes the job first."

**Screen:** live report appears, stage chips flip (Preparing → Needs you),
speed-ramped 2 s. Caption: **IT SCOPES FIRST**.

---

## Beat 4 · 0:18–0:28 — The questionnaire

**VO:** "It asks what a scaffolding firm would ask — options it generated
itself. Anything I don't care about? Decide for me. Confirm — the last time it
needs me."

**Screen:** questionnaire scroll (sped ~3 s), TWO answers clicked at normal
speed, **1 s hold on "Decide for me"**, Confirm → pipeline moves on.
Caption: **DECIDE FOR ME**.

---

## Beat 5 · 0:28–0:40 — Research + first candidates (12 s)

**VO:** "Then it works alone. Searches in Dutch and English. Real supplier
pages — marketplaces don't count. Eight firms shortlisted, four contacted by
email — and the first candidates are already in, every one deep-researched
before it ranks."

**Screen (speed-ramp 8–16×, holds ~0.7 s):**
1. Agent activity feed scrolling (queries visible: "steigerverhuur Den Haag…").
2. Inquiry cards filling, wave of 4 flipping to "contacted".
3. **HOLD**: one outbound email flashes.
4. Options counter ticking ("N options so far") — first candidate cards visible.
Captions in rhythm: **DUTCH + ENGLISH** · **REAL PAGES** · **4 EMAIL THREADS**.

---

## Beat 6 · 0:40–1:06 — The report (specifics, 26 s)

**VO:** "The deliverable: ranked, priced, evidenced. Number one — eighteen and a
half thousand, all-in, negotiated over email: the vendor asked, the agent
answered, the quote landed. Every price shows the unit it was quoted in. Every
claim links its source — the pages read, the emails exchanged, the caveats.
Where vendors stayed silent, the report says so — nothing invented. And the
whole run cost under fifty cents. Hours of sourcing — for pocket change."

**Screen:**
1. "Ready" badge + ranked list, slow scroll — **HOLD 2 s on #1** (confirmed
   total + BEST MATCH). Caption: **NEGOTIATED ALL-IN €18.5K**.
2. **HOLD 1.5 s**: the #1 thread — vendor reply → agent follow-up → final
   quote (zoom 130%). Caption: **REAL NEGOTIATION**.
3. **HOLD 1.5 s** on a per-m² option so the basis line is legible.
   Caption: **PRICES WITH THEIR UNITS**.
4. Dossier of #1 (sped scroll): sources → outreach evidence.
   Caption: **EVERY CLAIM SOURCED**.
5. 1 s: "report is ready" email in the inbox.
6. **[STATIC INSERT]** 2 s: cost view. Caption: **≈$0.50 ALL-IN vs $50–150 OF
   OFFICE TIME**.
7. **[STATIC INSERT]** 1.5 s: real Hundesalon thread. Caption: **PRODUCTION
   MODE: REAL VENDOR, REAL PRICE NEGOTIATED**.

---

## Beat 7 · 1:06–1:16 — Close

**VO:** "That's the whole loop — research, outreach, negotiation, delivered.
Built on Qwen Cloud, running on one Alibaba Cloud instance. Sign up, get ten
credits, run your own. inqi — one report, AI agents on it."

**Screen:** end card (deck slide 11 export) — URL, GitHub, 10-credits line.
Hold to end.

---

## Editing checklist

- Total ≤ 1:20. Devpost's 3:00 is a cap, not a target — short and dense wins.
- Speed-ramps: 8–16× on scrolling/waiting, ALWAYS return to ≤1× for the holds.
- Every held frame ≥0.7 s; Beat 6.2 (the negotiation thread) is THE money shot.
- Captions: 2–4 words, uppercase, lower third, one at a time.
- Zoom 125–150% in post wherever body text matters (thread, dossier, cost).
- Swap the €18.5K in Beat 6 VO + caption for the actual #1 quote of the filmed run.
- Blur any personal email addresses in the Hundesalon insert.
- Music: energetic but duck it −12 dB under VO; end on the card with logo sting.

## AI voiceover

Assertive, quick, confident — ElevenLabs voice at 1.05–1.1× pace fits this cut.
~185 words total ≈ 74 s. Record per-beat, cut footage to the VO, not vice versa.

Draft VO (timing rehearsal): `vo-draft/beat0..7.aiff` — macOS Samantha @185 wpm,
every beat measured within its slot. Spell the name "Inkey" in any TTS input so
it isn't read as "in-kwee"; swap these for ElevenLabs takes for the final cut.

# Phase 6 — Robot Studio usability walkthrough (P-03 / A-08)

**Date:** 2026-11-18 · **Method:** three scripted persona sessions driven through
the real UI (agent-browser + Playwright over the live dev stack: real APIs, real
DB, real venue market data). This is a **scripted proxy** for the founding
brief's "three-user usability check" — real human sessions on the founder's
host are still owed and are listed in the open-inputs register. What the proxy
can and cannot prove is stated per finding, honestly (D-03 rule applied to
research, not just to backtests).

**Task given to every persona:** *create your first robot and get to its first
backtest in one session.*

---

## Persona A — first-time trader (template path)

Profile assumption: knows prediction markets as a bettor, has never configured
a trading robot.

| Step | Result | Notes |
|------|--------|-------|
| Find Robot Studio | OK | nav label found immediately |
| Understand step 1 without help | OK | template cards + "Start from scratch" card visible first; venue/family pickers below |
| Pick "Contrarian Fade" template | OK | one click landed on **Review (step 5)** with venue, family, name ("Contrarian Fade 01"), capital, risk stops and entry rule all prefilled |
| Read the term sheet | OK | Template row states `Contrarian Fade (CONSERVATIVE)` — provenance of the config is on the sheet |
| Save as PAPER_ONLY draft | OK | primary action is save-as-draft; no activation affordance anywhere (B10 posture) |
| Guided session panel appears | OK | "From template 'Contrarian Fade' to first backtest" with three numbered steps |
| Run first cycle | OK | step 2 flipped to ✓; trace appeared on the dashboard |
| Run first backtest | **FRICTION FOUND → fixed** | see F1 below |
| Run first backtest (retry) | OK | step 3 flipped to ✓ |

## Persona B — quant tinkerer (scratch path)

Profile assumption: wants full control, distrusts presets.

| Step | Result | Notes |
|------|--------|-------|
| Ignore templates, pick venue+family | OK | Manifold + AI Research selectable; PENDING venues visibly disabled with honest reasons |
| Name robot | OK | |
| Step 2: tune strategy knobs | OK | four C5 knobs (min edge, fade tilt, exit edge, max hold) now exposed and editable — previously this step was informational only; the wizard's knobs are the same values the cycle engine consumes |
| Review → create | OK | guided panel correctly states "From scratch to first backtest — Custom Scout B" |

## Persona C — operator (trace audit path)

Profile assumption: wants to verify a decision after the fact.

| Step | Result | Notes |
|------|--------|-------|
| Find the decision traces section | OK | dashboard lists recent traces with verdict + model chip |
| Expand a trace | OK | new A-08 depth panel opens in place |
| Read the provenance envelope | OK | model, kind, estimator version, cache state, screening verdict (PASS/FLAGGED colored), evidence hash (truncated, full hash on hover) |
| Read the pre-trade risk checks | OK | every check with PASS/FAIL chip and the measured detail (e.g. "market age 459s vs threshold 900s (S-10)", "order 20000¢ ≤ cap 20000¢") |
| Read the meta line | OK | trigger (SCHEDULE_TICK), strategy version id (C5), decision time |
| Same expansion in the venue workspace | OK | shared component; venue-scoped list behaves identically |

---

## Findings register

**F1 — Guided first backtest refused on a fresh database (found by Persona A).**
The guided backtest honestly returned 422 "insufficient tick history — N ticks
recorded, backtest needs at least 20": a fresh environment has 1–2 recorded
ticks per market, and the A-05 engine correctly refuses to replay thin history.
*Verdict: correct refusal, wrong guidance — the criterion "template → first
backtest in one guided session" failed in a clean environment.*
**Fix shipped in Phase 6:** (a) the backtest API's default market pick is now
venue-scoped (B11) and prefers candidates with ≥20 recorded ticks; (b) the
seed now writes its 120-tick SYNTHETIC-labeled history (honest label, D-03) to
the top-2 markets **per venue** instead of the top-3 across all venues, so a
Manifold-scoped AI Scout has replayable history too. Persona A's retry passed.
**Residual risk:** on a founder host with real accrual, the first session after
a wipe should either reseed or let the autopilot accrue a few cycles first —
the refusal message says exactly that.

**F2 — Wizard previously hid the strategy knobs (found by Persona B context).**
Step 2 only described the edge gate in prose. Fixed: the four C5 knobs are now
first-class step-2 controls; templates prefill them and scratch users tune
them. The knobs are the same values the cycle reads from the immutable
strategy version — no hidden divergence.

**F3 — Nothing to report on trace depth (Persona C).** The expansion pattern
kept the glanceable verdict collapsed and the evidence one click away; no
usability defect surfaced in the proxy. Real-user legibility of the hash and
check details remains open for the founder-host validation.

## Honest limits of this walkthrough

- The three personas were driven by the same operator (scripted sessions) —
  timing, error recovery and confusion signals from real humans are **not**
  measured here. The founding brief's three-user check remains owed on the
  founder's host; this document is the rehearsal script and the finding
  register to compare against.
- All sessions ran on the sandbox stack (paper mode, 90 synced markets,
  seeded robots). Store-grade environments (Phase 9) and live-adjacent load
  (Phase 7.5) can shift what "feels slow" means; the B5 budgets apply there.

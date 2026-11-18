# Closed Beta Program — Phase 7.5 (R-02, locked)

Program definition for the closed-beta cohort that gates the move from
Phase 7.5 to Phase 8. The beta runs **paper + small live** (Phase 7 pilot
ceilings: $20 order / $50 per-robot lifetime, Polymarket-only) under the same
gates as production: B10 gate stack, C25 recorded consent, DRY-RUN send armor
until the founder arms on the founder host, C4.5 eligibility, S-08 custody.

## 1. Cohort

- **Size: 10–25 users.** Start at 10 (round 1), grow toward 25 only while the
  exit bar holds. Members are recruited by the founder; no public signup.
- Mix: at least 3 paper-only users (strategy-lab focus), at least 3
  live-pilot users (gated path focus), the rest free choice.
- Every member onboards through the real stack: account + jurisdiction
  (C4.5), wallet registration (B1, address only), robot via the Robot Studio
  wizard (templates P-03 supported), consent recording (C25) before any
  live-pilot request.
- Data honesty (D-03): every number a member sees is labeled SYNTHETIC vs
  LIVE vs DEMO_SNAPSHOT. Backtests are evidence, never promises (hard
  invariant 7).

## 2. Weekly rounds

Each round is one calendar week, run by the founder (or an operator with the
runbooks):

| Step | Activity | Instrument |
|---|---|---|
| R-0 | Health snapshot at round start: error rates, refusals, latency p95 from the load protocol, open defect count | `GET /api/health`, traces, this file's defect ledger |
| R-1 | Cohort session: what members tried, what confused them, what broke | feedback notes appended to the round entry |
| R-2 | Triage: every defect classified S0–S3 (ladder below), owner + fix-phase assigned | defect ledger update |
| R-3 | Runbook rehearsal: at least ONE runbook from `docs/RUNBOOKS.md` drilled against the live cohort instance | drill output appended |
| R-4 | Kill-switch drill C19.1 once per round on the beta instance | `scripts/kill_switch_drill.py` |
| R-5 | Round close: decision — continue / hold cohort growth / escalate | founder sign-off in the round entry |

Round 1 starts when the founder host is ready (fine-grained PAT delivered,
commits pushed, B3 counsel sign-off recorded, arm switch still SAFE until the
founder's explicit authorization per B10).

## 3. Defect severity ladder

| Sev | Definition | Response |
|---|---|---|
| S0 | Money risk: wrong fill, wrong balance, ledger drift, gate bypass, custody concern | STOP the round; global pause (C19); fix before anything else |
| S1 | Safety or honesty regression: gate refuses wrongly (fail-closed on truth), missing provenance, mislabeled evidence, data loss | Fix within the round; cohort growth on hold |
| S2 | Functional break with a workaround (UI dead-end, export broken, confusing refusal text) | Scheduled to a fix phase; tracked |
| S3 | Cosmetic / wording / minor UX | Backlog |

Every S0/S1 gets a post-fix regression check added to the phase smoke suite
(`scripts/smoke_phase75.py` or the phase smokes) before the round closes.

## 4. Exit defect bar (measurable — all must hold at beta exit)

1. **Zero open S0** and **zero open S1** defects.
2. **≤ 3 open S2** defects, each with a named fix phase and no workaround
   older than two rounds.
3. **No open safety or honesty regressions** — every B10/C25/C19.1/B1/C4.5
   invariant re-verified by the smoke suite within the last 7 days.
4. **All six runbooks drilled** on the beta instance within the last 14 days
   (R1–R5 via `drill_phase75.py`, R6 via `demotion_drill.py`).
5. **B5 targets met on the founder host**: 500-robot load pass (p95 ≤ 750 ms
   at the protocol concurrency), availability ≥ 99.5%, on production config
   (sandbox numbers: p95 699 ms at 16-way, 100% availability, 2026-11-18 —
   founder-host rerun owed before exit).
6. **72-hour soak green** on the beta instance (P3.5 acceptance, full variant
   — the sandbox ran the shortened variant).
7. **Live-pilot sanity**: at least one gated live-pilot robot completes a
   DRY-RUN signed order end-to-end (signed, hashed, journaled, nothing sent)
   on the founder host with consent + gates + pilot caps verified — still
   SAFE posture unless the founder explicitly arms.
8. **Cohort signal**: ≥ 60% of active members completed ≥ 3 robot sessions
   and submitted ≥ 1 feedback item; no unresolved consent or data-handling
   complaint.

Failing any item holds the cohort at its current size (or pauses it) until
fixed; the bar gates Phase 8 (billing) — commercialization never starts on
top of an open S0/S1.

## 5. Operator cadence reference

- Runbooks: `docs/RUNBOOKS.md` (R1–R6 + C19.1) — written AND drilled.
- Chaos review: `scripts/chaos_phase75.py` (X1–X6, all fail-closed) — suite
  reviewed 2026-11-18; findings fixed in-phase (atomic lease claim, atomic
  wizard create, WAL + `connection_limit=1` posture).
- Load: `scripts/load_phase75.py --robots 500 --concurrency 16`.
- Smoke: `python3 scripts/smoke_phase75.py` (Phase 7.5 acceptance gate).

## 6. Round ledger

| Round | Dates | Cohort | Round entry (summary, defects, drills, decision) |
|---|---|---|---|
| 1 | TBD — starts on founder host readiness | 10 | pending B3 counsel sign-off + founder host (commits delivered 2026-11-18) |

(The ledger is appended per round; entries never rewritten — the exit bar is
audited against this table.)

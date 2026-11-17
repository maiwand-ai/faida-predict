# Operations Runbooks — FAIDA Predict (Phase 7.5, R-02)

Every runbook below is **written AND drilled**: the drill executes the
procedure through the real API stack (`scripts/drill_phase75.py`, R1–R5), the
governance drill (`scripts/demotion_drill.py`, R6) and the kill-switch drill
(`scripts/kill_switch_drill.py`, C19.1). All drills are self-cleaning and
repeatable. Drill evidence dates: **2026-11-18** (see §4 Phase 7.5 in
`docs/DEVELOPMENT_PLAN.md` for the full check lists).

Common prerequisites: dev/production server on `:3000` (`GET /api/health` →
200), SQLite DB at `db/custom.db`, and a shell with Python 3 for the drills.
Money is integer cents everywhere (S-09); UNKNOWN orders resolve only via
reconciliation evidence (S-01/S-04); every entity names its venue (B11).

Startup posture check (before any runbook): `PRAGMA journal_mode` on
`db/custom.db` must return `wal` (set persistently in Phase 7.5 — see
DECISIONS.md "SQLite concurrency posture") and the server env must carry
`DATABASE_URL=...?connection_limit=1&pool_timeout=120`. A server started
without them convoys under concurrent writes (P1008/P2028 timeouts).

---

## R1 — Startup reconciliation

**Trigger / symptoms.** After a crash, restart or lost submission: orders
stuck in `RECONCILING` / `UNKNOWN`, open `ReconciliationEntry` drift, pending
`OutboxEvent` rows that never dispatched.

**Diagnosis.**
1. Count stuck orders: `SELECT state, COUNT(*) FROM "Order" WHERE state IN ('RECONCILING','UNKNOWN') GROUP BY state;`
2. Open drift: `SELECT orderId, kind FROM ReconciliationEntry WHERE resolvedAt IS NULL;`
3. Pending outbox: `SELECT eventType, COUNT(*) FROM OutboxEvent WHERE status='PENDING' GROUP BY eventType;`

**Remediation.** Run the reconciliation pass — it resolves orders ONLY via
venue evidence (adapter looked up by the order's venue, B11), journals every
transition (S-01), closes open drift entries for resolved orders (S-04
hygiene) and drains the outbox in the same call:

```
curl -X POST http://localhost:3000/api/cycle -H 'Content-Type: application/json' -d '{"action":"RECONCILE"}'
```

A venue truth of "not found" resolves the order to `REJECTED`
(`reconciliation: order not found on venue — treated as rejected`); a matched
fill/cancel resolves to `FILLED`/`CANCELLED`; anything unconfirmed stays
`UNKNOWN` with a refreshed drift entry. Never resolve by hand — hope is not
evidence (hard invariant 2).

**Verification.** Steps 1–3 report zero `UNKNOWN`/`RECONCILING`, zero open
drift, and the pending backlog drained.

**Drill evidence.** `drill_phase75.py` R1: UNKNOWN fixture order + open drift
entry + pending outbox row → RECONCILE → order `REJECTED` with the evidence
clause, transition journaled, drift entry closed, outbox `DISPATCHED`. PASS
2026-11-18.

---

## R2 — Stuck-robot diagnosis

**Trigger / symptoms.** A robot is `RUNNING`/`PAPER_ONLY` but produces no
fresh `DecisionTrace`; the scheduler reports lease refusals.

**Diagnosis.**
1. Trace absence window: `SELECT COUNT(*), MAX(createdAt) FROM DecisionTrace WHERE robotId='<id>';`
2. Lease holder: `SELECT holder, acquiredAt, expiresAt FROM RobotLease WHERE robotId='<id>';`
   A holder that no longer corresponds to a live runner (crashed scheduler,
   killed deploy) plus an `expiresAt` in the future = stuck lease.
3. Confirm the refusal path: `curl -X POST http://localhost:3000/api/robots/<id>/cycle`
   returns `no-trade: robot lease held by another runner (S-06) until …` with
   `traceId: "-"` (no trace written).

**Remediation.** Wait for expiry (leases carry a 120 s TTL by design — a
crashed runner never wedges the robot forever) or, for a confirmed-dead
holder, clear it: `DELETE FROM RobotLease WHERE robotId='<id>';` Re-tick —
the claim is atomic since the Phase 7.5 hardening (single `INSERT` racing a
unique constraint + conditional expired-takeover `UPDATE`; chaos X5 earlier
exposed a check-then-upsert race here that concurrent schedulers could hit).

**Verification.** The re-tick returns a real `traceId` and a fresh
`DecisionTrace` exists whose reason is NOT a staleness refusal.

**Drill evidence.** `drill_phase75.py` R2: lease held by `crashed-runner-r2`
→ tick refuses naming the runner (S-06), no trace; after expiry the tick
takes over and evaluates a fresh book. PASS 2026-11-18.

---

## R3 — Venue outage

**Trigger / symptoms.** Venue API down or a venue's books unusable: market
sync fails, robots refuse with `no eligible live market on <VENUE>`, or the
S-10 staleness gate refuses with `stale market data — age … exceeds freshness
threshold …`.

**Diagnosis.**
1. Which venue: refusal reasons name the venue on every trace and tick
   summary (B11 — every robot, market, order names its venue).
2. Book age: `SELECT venue, MIN(updatedAt), COUNT(*) FROM Market WHERE ambiguityFlag=0 AND resolvedAt IS NULL GROUP BY venue;`
3. Sync attempt through the real adapter: `curl -X POST http://localhost:3000/api/markets -H 'Content-Type: application/json' -d '{"venue":"<VENUE>"}'` — a venue outage fails here first.

**Remediation.** The platform needs no operator action to stay safe: robots
scoped to the dead venue fail CLOSED (no market selected → no decision → no
order), and any order path against a stale book is refused by the pre-trade
staleness gate (S-10). If the outage is prolonged, pause globally
(`POST /api/control {"action":"PAUSE","reason":"venue <VENUE> outage"}`) or
stop the affected robots (`PATCH /api/robots {"robotId":…,"status":"PAUSED_BY_USER"}`).
For a PERMANENT outage, flip the venue's status row in `src/lib/venues.ts`
(config, never code at call sites) — precedent: Drift BET marked SUSPENDED
after the April 2026 exploit, robots on it refuse with a 422 naming the
venue. Do NOT relax `ambiguityFlag` or staleness thresholds to force trading.

**Verification.** Refusal traces name the venue and carry `traceId` only
where a decision was attempted; zero orders are placed against the venue
while down; after sync restores, the next tick evaluates a fresh book.

**Drill evidence.** `drill_phase75.py` R3: every market on the venue flagged
ineligible (outage simulation) → 8-tick concurrent burst refuses naming
`MANIFOLD`, zero traces, zero 5xx; restore → all ticks evaluate fresh books.
Chaos X1 re-proves the same fail-closed posture under concurrency. PASS
2026-11-18.

---

## R4 — Fee update

**Trigger / symptoms.** A venue changes its taker fee schedule; edges must be
repriced net of the new fee before the next tick (rule b — edge after fees).

**Diagnosis.** Fee snapshots live ON the market row, captured at sync (C4.4 —
fee schedule is config, never hardcoded): `SELECT id, question, yesTakerFeeBps,
noTakerFeeBps FROM Market WHERE venue='<VENUE>';`

**Remediation.** Update the bps columns for the affected venue's markets (or
re-sync, which re-captures the schedule):

```
UPDATE Market SET yesTakerFeeBps=<bps>, noTakerFeeBps=<bps> WHERE venue='<VENUE>';
```

The very next tick prices the drag with the stored schedule: the trace reason
carries the clause `− <drag> pts <VENUE> taker fee (<bps>bps @ <price>¢) =
<nets> pts net`, where `drag = price × bps / 10000` (breakeven moves from p
to p×(1+fee)). Paper fills charge the fee; the live edge gate sees the same
fee-adjusted number.

**Verification.** Pick any tick on the venue after the update and recompute
`price × bps / 10000` — it must equal the clause drag to rounding. NO_TRADE
refusals also carry the clause, so verification works even when nothing
trades.

**Drill evidence.** `drill_phase75.py` R4: clause bps matched the stored
schedule (side resolved by entry price), drag matched the formula; a
+300 bps operator bump was visible on the very next tick and repriced both
drag and net edge exactly. Fee schedule restored afterwards. PASS 2026-11-18.
(In the current sandbox no venue ships fee snapshots on fresh books; the
drill seeded a config fee on MANIFOLD per C4.4 and restored it — Limitless,
the fee-bearing venue, had stale books at drill time.)

---

## R5 — Jurisdiction update

**Trigger / symptoms.** A regulator action, geo-block or sanction-list change
requires flipping a country's eligibility (C4.5 matrix — editable config,
never hardcoded at call sites).

**Diagnosis.** Read the matrix: `curl http://localhost:3000/api/eligibility`
(rows carry `allowed`, `reason`, and `source`: PLATFORM / VENUE [VERIFY] /
SANCTION_LIST).

**Remediation.**
- Flip a row: `curl -X PUT http://localhost:3000/api/eligibility -H 'Content-Type: application/json' -d '{"country":"<ISO>","allowed":false,"reason":"<regulator action + date>"}'`
- Users in that country are refused at the order path's ELIGIBILITY stage
  (422 naming the rule) on their next attempt; existing positions are not
  liquidated automatically — escalate to the founder for disposal policy.
- **Sanction-list rows can never be flipped to allowed** — the API returns
  403 ("sanctioned jurisdictions can never be allowed — this is a hard
  platform invariant"). That invariant is not overrideable by any operator.

**Verification.** A manual paper order from an affected user returns 422
`stage: "ELIGIBILITY"` with the rule's reason; after a restore, the same
order trades again.

**Drill evidence.** `drill_phase75.py` R5: founder row (NL) flipped to
disallowed → manual order refused 422 ELIGIBILITY; IR (SANCTION_LIST) allow-
flip refused 403; restore → order trades again. PASS 2026-11-18.

---

## R6 — Model demotion

**Trigger / symptoms.** The ACTIVE probability model's recent calibration
window degrades — estimates drift opposite to outcomes; governance shows a
`demote` flag (A-01).

**Diagnosis.** Model registry state and calibration windows live in
`ProbabilityModel`; the governance surface is `POST /api/probability` with
actions `RECOMPUTE` (recompute calibration from resolved evidence) and
`CHECK_DEMOTION` (drill path — flags `demote` when the recent window
underperforms the baseline floor).

**Remediation.** Demotion is a governed round trip, never a manual row edit:
1. `POST /api/probability {"action":"RECOMPUTE"}` — refresh calibration from resolved evidence.
2. `POST /api/probability {"action":"CHECK_DEMOTION"}` — if flagged, the model steps down to the baseline floor; the previous ACTIVE model's pointer moves automatically.
3. Verify the journal: a `MODEL_GOVERNANCE` notification and a `MODEL_DEMOTED` outbox event exist (B8 — humans own activation, and the journal is the audit trail).

**Verification.** The registry shows the demoted model no longer ACTIVE;
traces after the demotion name the baseline model (`modelKey`) with honest
provenance (A-02); no estimate from the demoted model appears in new traces.

**Drill evidence.** `scripts/demotion_drill.py` (A-01): full round trip —
candidate promoted on synthetic resolved evidence (DEM_SNAPSHOT-labeled, D-03),
corrupted window injected, RECOMPUTE flags `demote`, CHECK_DEMOTION demotes,
baseline returns, notifications + outbox recorded. Re-run PASS in the Phase
7.5 acceptance smoke (P75-4).

---

## C19.1 — Kill-switch drill (standing, from 7.5 cadence)

Not a runbook step but a scheduled operational drill (carry-forward register:
"periodically from 7.5"): `python3 scripts/kill_switch_drill.py` — pause
mid-run with MEASURED propagation, manual paper AND live order refusals while
paused, CRITICAL notification + PLATFORM_PAUSED outbox, resume restores,
audit fields present. The drill creates its own robot and removes it on exit.
Executed pre-Phase 7 (2026-11-18, DRILL PASS) and re-executed in the Phase
7.5 acceptance smoke (P75-5).

---

## Drill matrix

| Runbook | Drill script | Checks | Evidence |
|---|---|---|---|
| R1 startup reconciliation | `drill_phase75.py` | 7 | PASS 2026-11-18 |
| R2 stuck-robot diagnosis | `drill_phase75.py` | 7 | PASS 2026-11-18 |
| R3 venue outage | `drill_phase75.py` | 4 | PASS 2026-11-18 |
| R4 fee update | `drill_phase75.py` | 7 | PASS 2026-11-18 |
| R5 jurisdiction update | `drill_phase75.py` | 5 | PASS 2026-11-18 |
| R6 model demotion | `demotion_drill.py` | full round trip | re-run PASS (smoke P75-4) |
| C19.1 kill-switch | `kill_switch_drill.py` | 6 | re-run PASS (smoke P75-5) |
| Chaos suite (fail-closed under adversity) | `chaos_phase75.py` | 25 | PASS 2026-11-18 |
| B5 load protocol | `load_phase75.py --robots 500 --concurrency 16` | 6 | PASS 2026-11-18 (p95 699 ms, 100% availability) |

Rerun cadence: R1–R5 + chaos after every engine or gate change, before every
phase close; C19.1 monthly from 7.5; the full B5 load re-run on the founder
host before the live pilot scales.

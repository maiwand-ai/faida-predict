#!/usr/bin/env python3
# Phase 7.5 runbook drills (R1–R5) — every runbook in docs/RUNBOOKS.md is not
# just written but DRILLED through the real API stack. R6 (model demotion) and
# C19.1 (kill-switch) have dedicated drills that this phase re-runs:
#   scripts/demotion_drill.py (A-01) and scripts/kill_switch_drill.py (C19.1).
#   R1  startup reconciliation  — UNKNOWN order + open drift entry + pending
#       outbox → POST /api/cycle RECONCILE → resolved ONLY via venue evidence
#       (S-01/S-04), drift entry closed, outbox drained
#   R2  stuck-robot diagnosis   — lease held by a "crashed" runner → per-robot
#       tick refuses naming the holder (S-06); after expiry the tick takes
#       over and writes a fresh trace (diagnosis → remediation → verification)
#   R3  venue outage            — every market on the robot's venue flagged
#       ineligible → tick refuses naming the venue (B11), fail-closed;
#       restore → normal tick
#   R4  fee update              — fee schedule is config on the market (C4.4):
#       bump taker fee bps on the evaluated market → the NEXT tick's trace
#       reason prices the new fee drag exactly (p × bps / 10000); restore
#   R5  jurisdiction update     — flip a matrix row to disallowed (C4.5) →
#       manual order refuses at the ELIGIBILITY stage; sanctioned rows can
#       NEVER be flipped to allowed (hard invariant); restore → order trades
# Everything this drill creates is removed on exit so it is repeatable.
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://localhost:3000"
DB = str(Path(__file__).resolve().parent.parent / "db" / "custom.db")
T = int(time.time() * 1000)
failures = []
cleanup = {"robots": [], "orders": [], "outbox": [], "ledger_refids": []}
fee_backup = {}   # marketId -> (yes, no) original fee bps
volume_backup = {}  # marketId -> original volumeCents (R4 engine-pick coherence, restored in cleanup_all)
MIN_TOUCH = {"LIMITLESS": 5000, "KALSHI": 5000}  # armed structural rule (a) per src/lib/venue/rules.ts
flag_backup = {}  # marketId -> original ambiguityFlag


def check(name, cond, detail=""):
    ok = bool(cond)
    if not ok:
        failures.append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if (not ok and detail) else ""))


def api(method, path, body=None, timeout=180):
    req = urllib.request.Request(BASE + path, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode()), r.status
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode()), e.code
        except Exception:
            return {}, e.code


def db():
    conn = sqlite3.connect(DB, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def cleanup_all():
    conn = db()
    for ref in cleanup["ledger_refids"]:
        conn.execute("DELETE FROM LedgerEntry WHERE refId = ?", (ref,))
    for oid in cleanup["orders"]:
        conn.execute("DELETE FROM ReconciliationEntry WHERE orderId = ?", (oid,))
        conn.execute("DELETE FROM OrderEvent WHERE orderId = ?", (oid,))
        conn.execute("DELETE FROM Fill WHERE orderId = ?", (oid,))
        conn.execute("DELETE FROM \"Order\" WHERE id = ?", (oid,))
    for eid in cleanup["outbox"]:
        conn.execute("DELETE FROM OutboxEvent WHERE id = ?", (eid,))
    for rid in cleanup["robots"]:
        conn.execute("DELETE FROM RobotLease WHERE robotId = ?", (rid,))
        conn.execute("DELETE FROM DecisionTrace WHERE robotId = ?", (rid,))
        conn.execute("DELETE FROM OutboxEvent WHERE aggregateType='ROBOT' AND aggregateId = ?", (rid,))
        conn.execute("DELETE FROM StrategyVersion WHERE robotId = ?", (rid,))
        conn.execute("DELETE FROM Robot WHERE id = ?", (rid,))
    conn.execute("DELETE FROM MarketPriceTick WHERE capturedAt >= ?", (T - 1000,))
    for mid, (y, n) in fee_backup.items():
        conn.execute("UPDATE Market SET yesTakerFeeBps = ?, noTakerFeeBps = ? WHERE id = ?", (y, n, mid))
    for mid, v in volume_backup.items():
        conn.execute("UPDATE Market SET volumeCents = ? WHERE id = ?", (v, mid))
    for mid, f in flag_backup.items():
        conn.execute("UPDATE Market SET ambiguityFlag = ? WHERE id = ?", (f, mid))
    conn.commit()
    conn.close()


# ── R1: startup reconciliation ────────────────────────────────────────────
def drill_r1():
    print("\n── R1 startup reconciliation ─────────────────────────────────")
    conn = db()
    user = conn.execute("SELECT id FROM User WHERE email='founder@faida.local'").fetchone()
    market = conn.execute(
        "SELECT id FROM Market WHERE venue='MANIFOLD' AND ambiguityFlag=0 AND resolvedAt IS NULL AND yesPriceCents IS NOT NULL ORDER BY volumeCents DESC LIMIT 1"
    ).fetchone()
    if not user or not market:
        check("R1 fixtures available", False, "founder user or MANIFOLD market missing")
        conn.close()
        return
    uid, mid = user["id"], market["id"]
    conn.execute(
        "INSERT INTO \"Order\" (id, userId, marketId, mode, side, state, stateReason, priceCents, sizeCents, filledCents, feeCents, idempotencyKey, createdAt, updatedAt) "
        "VALUES (?, ?, ?, 'PAPER', 'BUY_YES', 'UNKNOWN', 'drill fixture: submission lost (R1)', 50, 500, 0, 0, ?, ?, ?)",
        (f"drill75r1_{T}", uid, mid, f"drill75-r1-{T}", T, T),
    )
    oid = f"drill75r1_{T}"
    cleanup["orders"].append(oid)
    conn.execute(
        "INSERT INTO ReconciliationEntry (id, orderId, kind, detail, createdAt) VALUES (?, ?, 'UNKNOWN_STATE', 'drill fixture: open drift from simulated crash (R1)', ?)",
        (f"drill75r1e_{T}", oid, T),
    )
    conn.execute(
        "INSERT INTO OutboxEvent (id, aggregateType, aggregateId, eventType, payload, status, attempts, emailStatus, createdAt) "
        "VALUES (?, 'LEDGER', ?, 'DRILL75_R1_PENDING', '{}', 'PENDING', 0, 'SKIP', ?)",
        (f"drill75r1o_{T}", oid, T),
    )
    cleanup["outbox"].append(f"drill75r1o_{T}")
    conn.commit()
    conn.close()

    res, code = api("POST", "/api/cycle", {"action": "RECONCILE"}, timeout=300)
    mine = [r for r in res.get("results", []) if r.get("orderId") == oid]
    check("R1 reconcile ran (200)", code == 200, str(code))
    check("R1 UNKNOWN order resolved via venue evidence", any(r.get("toState") == "REJECTED" for r in mine), json.dumps(mine)[:200])

    conn = db()
    row = conn.execute("SELECT state, stateReason FROM \"Order\" WHERE id = ?", (oid,)).fetchone()
    check("R1 order is REJECTED (reconciliation-only resolution, S-01)", row and row["state"] == "REJECTED", json.dumps(dict(row)) if row else "row missing")
    check("R1 reason is the NOT_FOUND evidence clause", row and "order not found on venue" in (row["stateReason"] or ""), (row["stateReason"] or "")[:120] if row else "")
    ev = conn.execute("SELECT COUNT(*) c FROM OrderEvent WHERE orderId = ? AND toState='REJECTED'", (oid,)).fetchone()
    check("R1 transition journaled (OrderEvent)", ev["c"] >= 1, f"{ev['c']} events")
    drift = conn.execute("SELECT resolvedAt FROM ReconciliationEntry WHERE orderId = ? AND kind='UNKNOWN_STATE'", (oid,)).fetchall()
    check("R1 open drift entry closed by evidence (S-04 hygiene)", drift and all(d["resolvedAt"] for d in drift), f"{len(drift)} entries")
    ob = conn.execute("SELECT status, dispatchedAt FROM OutboxEvent WHERE id = ?", (f"drill75r1o_{T}",)).fetchone()
    check("R1 pending outbox drained in the same pass", ob and ob["status"] == "DISPATCHED", json.dumps(dict(ob)) if ob else "missing")
    conn.close()


# ── R2: stuck-robot diagnosis ─────────────────────────────────────────────
def drill_r2():
    print("\n── R2 stuck-robot diagnosis ──────────────────────────────────")
    res, code = api("POST", "/api/robots", {
        "name": f"Runbook R2 Stuck Diagnosis {T}", "venue": "MANIFOLD", "family": "PROBABILITY_EDGE",
        "allocatedCents": 5000, "maxPositionCents": 500, "maxOpenPositions": 4,
    })
    check("R2 drill robot created", code == 200 and res.get("robot", {}).get("id"), json.dumps(res)[:160])
    rid = res.get("robot", {}).get("id")
    if not rid:
        return
    cleanup["robots"].append(rid)

    conn = db()
    conn.execute(
        "INSERT INTO RobotLease (id, robotId, holder, acquiredAt, expiresAt) VALUES (?, ?, 'crashed-runner-r2', ?, ?)",
        (f"drill75r2l_{T}", rid, T, T + 600_000),
    )
    conn.commit()
    conn.close()

    s, c1 = api("POST", f"/api/robots/{rid}/cycle")
    check("R2 per-robot tick endpoint live", c1 == 200, str(c1))
    check("R2 tick refuses while the lease is held by another runner (S-06)",
          "lease held by another runner" in s.get("reason", "") and "S-06" in s.get("reason", ""),
          s.get("reason", "")[:160])
    check("R2 refusal leaves no trace (diagnosis signal: trace absence)", s.get("traceId") == "-", s.get("traceId", ""))

    conn = db()
    lease = conn.execute("SELECT holder, expiresAt FROM RobotLease WHERE robotId = ?", (rid,)).fetchone()
    check("R2 diagnosis: lease row names holder + expiry", lease and lease["holder"] == "crashed-runner-r2", json.dumps(dict(lease)) if lease else "missing")
    conn.execute("UPDATE RobotLease SET expiresAt = ? WHERE robotId = ?", (T - 1000, rid))
    conn.commit()
    conn.close()

    s2, c2 = api("POST", f"/api/robots/{rid}/cycle")
    check("R2 after lease expiry the tick takes over", c2 == 200 and s2.get("traceId") not in ("-", None), s2.get("reason", "")[:160])
    check("R2 remediation verified: engine evaluated a fresh book (not a staleness refusal)",
          "stale market data" not in s2.get("reason", ""), s2.get("reason", "")[:160])
    conn = db()
    tr = conn.execute("SELECT COUNT(*) c FROM DecisionTrace WHERE robotId = ?", (rid,)).fetchone()
    check("R2 remediation verified: fresh decision trace written", tr["c"] >= 1, f"{tr['c']} traces")
    conn.close()


# ── R3: venue outage ──────────────────────────────────────────────────────
def drill_r3():
    print("\n── R3 venue outage ───────────────────────────────────────────")
    res, code = api("POST", "/api/robots", {
        "name": f"Runbook R3 Venue Outage {T}", "venue": "MANIFOLD", "family": "PROBABILITY_EDGE",
        "allocatedCents": 5000, "maxPositionCents": 500, "maxOpenPositions": 4,
    })
    check("R3 drill robot created", code == 200 and res.get("robot", {}).get("id"), json.dumps(res)[:160])
    rid = res.get("robot", {}).get("id")
    if not rid:
        return
    cleanup["robots"].append(rid)

    conn = db()
    rows = conn.execute("SELECT id, ambiguityFlag FROM Market WHERE venue='MANIFOLD'").fetchall()
    for r in rows:
        flag_backup[r["id"]] = r["ambiguityFlag"]
        conn.execute("UPDATE Market SET ambiguityFlag = 1 WHERE id = ?", (r["id"],))
    conn.commit()
    conn.close()

    s, c1 = api("POST", f"/api/robots/{rid}/cycle")
    check("R3 outage: tick refuses, venue named (B11), fail-closed",
          "no eligible live market on MANIFOLD" in s.get("reason", "") and s.get("traceId") == "-",
          s.get("reason", "")[:160])

    conn = db()
    for mid, f in flag_backup.items():
        conn.execute("UPDATE Market SET ambiguityFlag = ? WHERE id = ?", (f, mid))
    flag_backup.clear()
    conn.commit()
    conn.close()

    s2, c2 = api("POST", f"/api/robots/{rid}/cycle")
    check("R3 restore: normal tick resumes with a real trace", c2 == 200 and s2.get("traceId") not in ("-", None), s2.get("reason", "")[:120])
    check("R3 restore: engine evaluated a fresh book (not a staleness refusal)",
          "stale market data" not in s2.get("reason", ""), s2.get("reason", "")[:120])


# ── R4: fee update ────────────────────────────────────────────────────────
FEE_RE = re.compile(r"− ([\d.]+) pts (\w+) taker fee \((\d+)bps @ (\d+)¢\) = (-?[\d.]+) pts net")


def pick_fee_market(conn):
    # Fresh fee-bearing market (staleness threshold 900s — a stale book would
    # trip the S-10 gate before the fee clause is ever priced).
    row = conn.execute(
        "SELECT venue, COUNT(*) c FROM Market WHERE yesTakerFeeBps IS NOT NULL AND ambiguityFlag=0 AND resolvedAt IS NULL AND yesPriceCents IS NOT NULL AND updatedAt > ? GROUP BY venue ORDER BY c DESC LIMIT 1",
        (T - 890_000,),
    ).fetchone()
    return row["venue"] if row and row["c"] > 0 else None


def drill_r4():
    print("\n── R4 fee update ─────────────────────────────────────────────")
    conn = db()
    venue = pick_fee_market(conn)
    seeded_fee = False
    if not venue:
        venue = "MANIFOLD"
        seeded_fee = True
        print(f"  (no venue ships fee snapshots in this DB — seeding a config fee on MANIFOLD, C4.4: fee schedule is config)")
    # Fixture step (mirror of the MANIFOLD step in main): best-effort refresh
    # of the chosen venue's books through the REAL sync API so freshness (S-10)
    # and the depth columns reflect a real book — never faked (D-03).
    sm, scode = api("POST", "/api/markets", {"venue": venue}, timeout=180)
    print(f"  (fixture sync {venue}: HTTP {scode} synced={sm.get('synced')} source={sm.get('source')})" if isinstance(sm, dict) else f"  (fixture sync {venue}: HTTP {scode})")
    # Depth-qualified + fresh selection (Phase 10 fix, coherence-hardened
    # 2026-11-18): the armed venue entry rules refuse thin or missing touch
    # depth fail-closed (rule (a) on LIMITLESS/KALSHI — minTouchDepthCents per
    # src/lib/venue/rules.ts), and the S-10 gate refuses stale books — so the
    # drill must exercise a FRESH market the risk gate would allow on THIS
    # venue's armed rules (the old NULL-depth branch was incoherent for venues
    # where rule (a) is armed: fail-closed on null). If no market qualifies,
    # the drill fails honestly instead of pricing no clause.
    min_touch = MIN_TOUCH.get(venue)
    if min_touch:
        depth_clause = "(yesTouchDepthCents IS NOT NULL AND noTouchDepthCents IS NOT NULL AND yesTouchDepthCents >= ? AND noTouchDepthCents >= ?)"
        depth_params = (min_touch, min_touch)
    else:
        depth_clause = "((yesTouchDepthCents IS NOT NULL AND noTouchDepthCents IS NOT NULL) OR (yesTouchDepthCents IS NULL AND noTouchDepthCents IS NULL))"
        depth_params = ()
    market = conn.execute(
        "SELECT id, yesTakerFeeBps, noTakerFeeBps FROM Market WHERE venue=? AND ambiguityFlag=0 AND resolvedAt IS NULL AND yesPriceCents IS NOT NULL AND updatedAt > ? AND "
        + depth_clause +
        " ORDER BY volumeCents DESC LIMIT 1",
        (venue, T - 890_000, *depth_params),
    ).fetchone()
    if not market:
        check("R4 market available", False,
              f"no fresh depth-qualified market on {venue} (armed touch rule needs both touches >= {min_touch}¢ when armed; books must be freshly synced — S-10)")
        conn.close()
        return
    mid = market["id"]
    # Engine-pick coherence: the cycle engine evaluates the venue's TOP-VOLUME
    # market (no depth condition) — if that is not the drill's depth-qualified
    # pick, the structural rule correctly refuses the ENGINE's market and the
    # fee clause is never priced (observed 2026-11-18: top-volume LIMITLESS
    # book had NO touch 1500¢ vs minimum 5000¢ while the drill had picked a
    # deeper market). Lift the picked market above the venue max so the engine
    # and the drill evaluate the SAME book; restored in cleanup_all.
    top = conn.execute(
        "SELECT COALESCE(MAX(volumeCents), 0) AS mv FROM Market WHERE venue=? AND id != ?", (venue, mid),
    ).fetchone()
    mine = conn.execute("SELECT volumeCents FROM Market WHERE id = ?", (mid,)).fetchone()
    if (mine["volumeCents"] or 0) <= top["mv"]:
        volume_backup[mid] = mine["volumeCents"]
        conn.execute("UPDATE Market SET volumeCents = ? WHERE id = ?", (top["mv"] + 1000, mid))
    fee_backup[mid] = (market["yesTakerFeeBps"], market["noTakerFeeBps"])
    if seeded_fee:
        conn.execute("UPDATE Market SET yesTakerFeeBps = 300, noTakerFeeBps = 300 WHERE id = ?", (mid,))
    conn.commit()
    conn.close()

    res, code = api("POST", "/api/robots", {
        "name": f"Runbook R4 Fee Update {T}", "venue": venue, "family": "PROBABILITY_EDGE",
        "allocatedCents": 5000, "maxPositionCents": 500, "maxOpenPositions": 4,
    })
    check("R4 drill robot created", code == 200 and res.get("robot", {}).get("id"), json.dumps(res)[:160])
    rid = res.get("robot", {}).get("id")
    if not rid:
        return
    cleanup["robots"].append(rid)

    s1, _ = api("POST", f"/api/robots/{rid}/cycle")
    m1 = FEE_RE.search(s1.get("reason", ""))
    check("R4 tick trace prices the venue taker fee (clause present)", m1 is not None, s1.get("reason", "")[:200])
    if not m1:
        return
    drag0, venue0, bps0, price0, net0 = float(m1.group(1)), m1.group(2), int(m1.group(3)), int(m1.group(4)), float(m1.group(5))

    conn = db()
    mrow = conn.execute("SELECT yesPriceCents, noPriceCents, yesTakerFeeBps, noTakerFeeBps FROM Market WHERE id = ?", (mid,)).fetchone()
    yes0, no0 = mrow["yesTakerFeeBps"] or 0, mrow["noTakerFeeBps"] or 0
    check("R4 clause bps matches the stored fee schedule (C4.4 config, side resolved by entry price)",
          (m1.group(3) == str(yes0) and price0 == mrow["yesPriceCents"]) or (m1.group(3) == str(no0) and price0 == mrow["noPriceCents"]),
          f"clause {bps0}bps @ {price0}¢ vs stored yes {yes0} ({mrow['yesPriceCents']}¢) / no {no0} ({mrow['noPriceCents']}¢)")
    check("R4 fee drag matches the C4.4 formula p × bps / 10000",
          abs(drag0 - price0 * bps0 / 10000) < 0.15,
          f"clause drag {drag0:.2f} vs computed {price0 * bps0 / 10000:.2f}")
    conn.execute("UPDATE Market SET yesTakerFeeBps = ? + 300, noTakerFeeBps = ? + 300 WHERE id = ?", (yes0, no0, mid))
    conn.commit()
    conn.close()

    s2, _ = api("POST", f"/api/robots/{rid}/cycle")
    m2 = FEE_RE.search(s2.get("reason", ""))
    check("R4 post-update tick carries the fee clause", m2 is not None, s2.get("reason", "")[:200])
    if not m2:
        return
    drag1, venue1, bps1, price1, net1 = float(m2.group(1)), m2.group(2), int(m2.group(3)), int(m2.group(4)), float(m2.group(5))
    conn = db()
    mrow2 = conn.execute("SELECT yesPriceCents, noPriceCents FROM Market WHERE id = ?", (mid,)).fetchone()
    orig_for_side = yes0 if price1 == mrow2["yesPriceCents"] else no0
    conn.close()
    check("R4 operator fee bump visible in the very next tick (+300bps on the evaluated side)",
          bps1 == orig_for_side + 300 and venue1 == venue0,
          f"clause {bps1}bps on {venue1} vs original {orig_for_side}bps")
    check("R4 fee drag repriced by the formula after the bump",
          abs(drag1 - price1 * bps1 / 10000) < 0.15,
          f"clause drag {drag1:.2f} vs computed {price1 * bps1 / 10000:.2f}")

    conn = db()
    y, n = fee_backup.pop(mid)
    conn.execute("UPDATE Market SET yesTakerFeeBps = ?, noTakerFeeBps = ? WHERE id = ?", (y, n, mid))
    conn.commit()
    conn.close()
    print(f"  (fee schedule restored on {mid})")


# ── R5: jurisdiction update ───────────────────────────────────────────────
def drill_r5():
    print("\n── R5 jurisdiction update ────────────────────────────────────")
    conn = db()
    market = conn.execute(
        "SELECT id, yesPriceCents FROM Market WHERE venue='MANIFOLD' AND ambiguityFlag=0 AND resolvedAt IS NULL AND yesPriceCents IS NOT NULL ORDER BY volumeCents DESC LIMIT 1"
    ).fetchone()
    country = conn.execute("SELECT country FROM User WHERE email='founder@faida.local'").fetchone()
    conn.close()
    if not market or not country:
        check("R5 fixtures available", False, "no MANIFOLD market or founder user")
        return
    mid = market["id"]
    geo = country["country"]
    print(f"  (founder jurisdiction: {geo})")

    res, code = api("PUT", "/api/eligibility", {"country": geo, "allowed": False, "reason": f"RUNBOOK R5 drill {T} — restored after"})
    check("R5 matrix row flips to disallowed via API (C4.5)", code == 200, f"{code} {json.dumps(res)[:120]}")

    nonce = f"drill75-r5-{T}"
    res2, code2 = api("POST", "/api/orders", {
        "marketId": mid, "side": "BUY_YES", "priceCents": market["yesPriceCents"] or 50,
        "sizeCents": 500, "nonce": nonce,
    })
    check("R5 order refused while jurisdiction restricted (422 ELIGIBILITY)",
          code2 == 422 and res2.get("stage") == "ELIGIBILITY", f"{code2} {json.dumps(res2)[:200]}")

    res3, code3 = api("PUT", "/api/eligibility", {"country": "IR", "allowed": True})
    check("R5 sanctioned row can NEVER be allowed (hard invariant)", code3 == 403, f"{code3} {json.dumps(res3)[:160]}")

    res4, code4 = api("PUT", "/api/eligibility", {"country": geo, "allowed": True, "reason": "restored after RUNBOOK R5 drill"})
    check("R5 matrix restored", code4 == 200, str(code4))
    nonce2 = f"drill75-r5-ok-{T}"
    res5, code5 = api("POST", "/api/orders", {
        "marketId": mid, "side": "BUY_YES", "priceCents": market["yesPriceCents"] or 50,
        "sizeCents": 500, "nonce": nonce2,
    })
    ok = code5 == 200 and res5.get("orderId")
    check("R5 restore verified: order trades again", ok, f"{code5} {json.dumps(res5)[:160]}")
    if ok:
        cleanup["orders"].append(res5["orderId"])
        cleanup["ledger_refids"].append(res5["orderId"])


def main():
    print(f"Phase 7.5 runbook drills — {time.strftime('%Y-%m-%d %H:%M:%S')} — base {BASE}")
    try:
        # fixture step: refresh venue books through the REAL sync API so the
        # S-10 staleness gate passes on live data (never faked — D-03)
        sm, scode = api("POST", "/api/markets", {"venue": "MANIFOLD"}, timeout=180)
        check("fixture: MANIFOLD books synced via the live adapter", scode == 200 and sm.get("synced", 0) > 0,
              f"{scode} synced={sm.get('synced')} source={sm.get('source')}")
        drill_r1()
        drill_r2()
        drill_r3()
        drill_r4()
        drill_r5()
    finally:
        cleanup_all()
        print("\ncleanup: fixtures removed, fee schedule + eligibility matrix restored")
    if failures:
        print(f"\nDRILL FAIL ({len(failures)}): " + "; ".join(failures))
        sys.exit(1)

    # Phase 10: stamp the exit-bar drill timestamp (best-effort — a marker
    # failure must never mask a PASS; the key reads honestly STALE/UNKNOWN).
    try:
        api("POST", "/api/beta/drill-marker", {"kind": "RUNBOOK_DRILL"}, timeout=30)
    except Exception:
        pass
    print("\nDRILL PASS (R1–R5)")


if __name__ == "__main__":
    main()

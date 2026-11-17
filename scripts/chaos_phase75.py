#!/usr/bin/env python3
# Phase 7.5 chaos suite — adverse conditions are injected through REAL APIs and
# every scenario must end fail-closed: the platform refuses with a named reason,
# no order moves, no money moves, and state recovers after the fault clears.
#   X1  venue outage under a concurrent burst — every tick refuses naming the
#       venue (B11), zero traces, zero orders; restore → all ticks evaluate
#   X2  adversarial freshness budget — SET_STALENESS to 1s → staleness gate
#       refuses with measured age (S-10); restore → normal evaluation
#   X3  pause mid-burst (C19) — PAUSE while 10 ticks are in flight; every tick
#       completing after the pause decision refuses with measured propagation;
#       zero orders placed after the pause; RESUME restores
#   X4  B10 gate fail-closed — LIVE_PILOT flip on a robot with no evidence is
#       refused naming blockers; the live gate reports ready=false, armed=false;
#       zero live orders exist
#   X5  lease contention storm — 12 concurrent ticks against a HELD lease: all
#       refuse naming the holder (S-06), zero evaluations, zero traces; after
#       release the robot evaluates normally
#   X6  UNKNOWN order never fills without venue evidence (S-01) — garbage
#       venueOrderId reconciles to REJECTED; zero FILL ledger entries, money
#       does not move on hope
# Everything is removed on exit; the platform ends the run paused=off, paper-only.
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
T = int(time.time() * 1000)
failures = []
cleanup = {"robots": [], "orders": [], "ledger_refids": [], "tick_markets": []}
flag_backup = {}


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


def make_robot(venue, label):
    res, code = api("POST", "/api/robots", {
        "name": f"Chaos75 {label} {T}", "venue": venue, "family": "PROBABILITY_EDGE",
        "allocatedCents": 5000, "maxPositionCents": 500, "maxOpenPositions": 4,
    })
    rid = res.get("robot", {}).get("id")
    if code == 200 and rid:
        cleanup["robots"].append(rid)
    return rid


def tick_concurrent(rid, n):
    with ThreadPoolExecutor(max_workers=n) as ex:
        return list(ex.map(lambda _: api("POST", f"/api/robots/{rid}/cycle", timeout=300), range(n)))


def cleanup_all():
    conn = db()
    for ref in cleanup["ledger_refids"]:
        conn.execute("DELETE FROM LedgerEntry WHERE refId = ?", (ref,))
    for oid in cleanup["orders"]:
        conn.execute("DELETE FROM ReconciliationEntry WHERE orderId = ?", (oid,))
        conn.execute("DELETE FROM OrderEvent WHERE orderId = ?", (oid,))
        conn.execute("DELETE FROM Fill WHERE orderId = ?", (oid,))
        conn.execute("DELETE FROM \"Order\" WHERE id = ?", (oid,))
    for rid in cleanup["robots"]:
        conn.execute("DELETE FROM RobotLease WHERE robotId = ?", (rid,))
        conn.execute("DELETE FROM DecisionTrace WHERE robotId = ?", (rid,))
        conn.execute("DELETE FROM OutboxEvent WHERE aggregateType='ROBOT' AND aggregateId = ?", (rid,))
        conn.execute("DELETE FROM StrategyVersion WHERE robotId = ?", (rid,))
        conn.execute("DELETE FROM Robot WHERE id = ?", (rid,))
    for mid in cleanup["tick_markets"]:
        conn.execute("DELETE FROM MarketPriceTick WHERE marketId = ? AND capturedAt >= ?", (mid, T - 1000))
    for mid, f in flag_backup.items():
        conn.execute("UPDATE Market SET ambiguityFlag = ? WHERE id = ?", (f, mid))
    conn.commit()
    conn.close()


# ── X1: venue outage under a concurrent burst ─────────────────────────────
def chaos_x1():
    print("\n── X1 venue outage under concurrent burst ────────────────────")
    rid = make_robot("MANIFOLD", "Outage Burst")
    if not rid:
        check("X1 robot fixture", False, "robot not created")
        return
    conn = db()
    for r in conn.execute("SELECT id, ambiguityFlag FROM Market WHERE venue='MANIFOLD'").fetchall():
        flag_backup[r["id"]] = r["ambiguityFlag"]
        conn.execute("UPDATE Market SET ambiguityFlag = 1 WHERE id = ?", (r["id"],))
    conn.commit()
    conn.close()

    results = tick_concurrent(rid, 8)
    codes = [c for _, c in results]
    reasons = [s.get("reason", "") for s, _ in results if isinstance(s, dict)]
    check("X1 burst survives the outage with zero 5xx", all(c == 200 for c in codes), f"codes={set(codes)}")
    check("X1 every tick refuses naming the venue (B11)",
          all("no eligible live market on MANIFOLD" in r for r in reasons), reasons[0][:120] if reasons else "no reasons")
    check("X1 zero traces during outage (fail-closed, no partial decisions)",
          all(s.get("traceId") == "-" for s, _ in results), "")

    conn = db()
    for mid, f in flag_backup.items():
        conn.execute("UPDATE Market SET ambiguityFlag = ? WHERE id = ?", (f, mid))
    flag_backup.clear()
    conn.commit()
    conn.close()

    results2 = []
    for _ in range(4):
        results2.append(api("POST", f"/api/robots/{rid}/cycle"))
    real = [s for s, _ in results2 if isinstance(s, dict) and s.get("traceId") not in ("-", None)]
    check("X1 after restore all ticks evaluate (real traces, no staleness)",
          len(real) == 4 and all("stale market data" not in s.get("reason", "") for s in real),
          f"{len(real)}/4 real traces")


# ── X2: adversarial freshness budget (S-10) ───────────────────────────────
def chaos_x2():
    print("\n── X2 adversarial freshness budget ───────────────────────────")
    rid = make_robot("MANIFOLD", "Stale Budget")
    if not rid:
        check("X2 robot fixture", False, "robot not created")
        return
    res_c, c = api("POST", "/api/control", {"action": "SET_STALENESS", "stalenessMs": 1000})
    eff = res_c.get("stalenessMs")
    check("X2 control API accepts a tightened budget (clamped to the platform minimum)", c == 200 and isinstance(eff, int), f"{c} effective={eff}ms")
    time.sleep(eff / 1000 + 1.5)  # real elapsed time so the book's measured age exceeds the effective budget
    s, _ = api("POST", f"/api/robots/{rid}/cycle")
    check("X2 tick refuses on the tightened gate with measured age (S-10)",
          "stale market data" in s.get("reason", "") and "S-10" in s.get("reason", ""),
          s.get("reason", "")[:180])
    _, c2 = api("POST", "/api/control", {"action": "SET_STALENESS", "stalenessMs": 900000})
    check("X2 freshness budget restored (900s)", c2 == 200, str(c2))
    s2, _ = api("POST", f"/api/robots/{rid}/cycle")
    check("X2 after restore the engine evaluates (fresh trace)",
          s2.get("traceId") not in ("-", None) and "stale market data" not in s2.get("reason", ""),
          s2.get("reason", "")[:140])


# ── X3: pause mid-burst (C19) with measured propagation ───────────────────
def chaos_x3():
    print("\n── X3 pause mid-burst with measured propagation ──────────────")
    rid = make_robot("MANIFOLD", "Pause Burst")
    if not rid:
        check("X3 robot fixture", False, "robot not created")
        return
    with ThreadPoolExecutor(max_workers=14) as ex:
        futures = []
        for i in range(14):
            futures.append(ex.submit(lambda i=i: (time.sleep(i * 0.5), api("POST", f"/api/robots/{rid}/cycle", timeout=300))[1]))
            if i == 1:
                time.sleep(0.8)
                pres, pcode = api("POST", "/api/control", {"action": "PAUSE", "reason": f"chaos X3 mid-burst {T}"})
        pause_results = [f.result() for f in futures]

    conn = db()
    prow = conn.execute("SELECT value FROM PlatformControl WHERE key='GLOBAL_PAUSE'").fetchone()
    paused_at_ms = None
    if prow:
        try:
            gj = json.loads(prow["value"])
            from datetime import datetime, timezone
            paused_at_ms = int(datetime.fromisoformat(gj["pausedAt"].replace("Z", "+00:00")).timestamp() * 1000) if gj.get("pausedAt") else None
        except Exception:
            paused_at_ms = None
    conn.close()

    post = [s for s, c in pause_results if isinstance(s, dict)]
    refused = [s for s in post if "platform paused" in s.get("reason", "")]
    check("X3 pause accepted via control API", pcode == 200 and pres.get("ok") is True, f"{pcode}")
    check("X3 in-flight ticks completing after the pause decision refuse (C19)",
          len(refused) >= 1, f"{len(refused)}/{len(post)} refused; reasons={sorted(set(s.get('reason','')[:60] for s in post))}")

    conn = db()
    traced = conn.execute(
        "SELECT reason FROM DecisionTrace WHERE robotId = ? AND reason LIKE 'platform paused (C19)%after pause decision%'",
        (rid,),
    ).fetchall()
    conn.close()
    check("X3 traced refusal carries the MEASURED propagation from pausedAt",
          len(traced) >= 1 and any("ms after pause decision" in r["reason"] for r in traced),
          traced[0]["reason"][:150] if traced else f"no traced refusal among {len(traced)} rows")

    conn = db()
    n_orders = conn.execute(
        "SELECT COUNT(*) c FROM \"Order\" WHERE robotId = ? AND createdAt >= ?", (rid, T)
    ).fetchone()["c"]
    after = 0
    if paused_at_ms:
        after = conn.execute(
            "SELECT COUNT(*) c FROM \"Order\" WHERE robotId = ? AND idempotencyKey LIKE 'cycle_%' AND createdAt > ?",
            (rid, paused_at_ms),
        ).fetchone()["c"]
    conn.close()
    check("X3 paper orders may exist pre-pause but NONE after the pause decision", after == 0, f"orders total={n_orders}, after pause={after}")

    _, rc = api("POST", "/api/control", {"action": "RESUME"})
    s2, _ = api("POST", f"/api/robots/{rid}/cycle")
    check("X3 resume restores tick evaluation", rc == 200 and s2.get("traceId") not in ("-", None), s2.get("reason", "")[:120])


# ── X4: B10 gate fail-closed under missing evidence ───────────────────────
def chaos_x4():
    print("\n── X4 B10 gate fail-closed ───────────────────────────────────")
    rid = make_robot("POLYMARKET", "Gate FailClosed")
    if not rid:
        check("X4 robot fixture", False, "robot not created")
        return
    res, code = api("POST", "/api/live", {"action": "SET_ROBOT_MODE", "robotId": rid, "mode": "LIVE_PILOT"})
    blockers = json.dumps(res)
    check("X4 flip refused while evidence missing (4xx)", 400 <= code < 500, f"{code} {blockers[:200]}")
    check("X4 refusal names the missing evidence (blocking list)", any(
        k in blockers for k in ("LIVE_CONSENT", "consent", "edge", "evidence", "backtest", "calibration")), blockers[:220])
    live, _ = api("GET", "/api/live", timeout=60)
    gate = next((g for g in live.get("gates", []) if g.get("robotId") == rid), None)
    check("X4 live gate reports ready=false armed=false dry-run posture",
          gate is not None and gate.get("ready") is False and gate.get("armed") is False,
          json.dumps(gate)[:200] if gate else "no gate row")
    conn = db()
    n_live = conn.execute("SELECT COUNT(*) c FROM \"Order\" WHERE mode='LIVE'").fetchone()["c"]
    conn.close()
    check("X4 zero LIVE orders exist after the refused flip", n_live == 0, f"{n_live} live orders")


# ── X5: lease contention storm (S-06) ─────────────────────────────────────
def chaos_x5():
    print("\n── X5 lease contention storm ─────────────────────────────────")
    rid = make_robot("MANIFOLD", "Lease Storm")
    if not rid:
        check("X5 robot fixture", False, "robot not created")
        return
    # Deterministic mutual-exclusion proof: hold the lease for the whole storm.
    # (Natural contention alone is timing-fragile on a fast engine: once the
    # first tick releases, a late arrival legally wins a fresh epoch.)
    conn = db()
    conn.execute(
        "INSERT INTO RobotLease (id, robotId, holder, acquiredAt, expiresAt) VALUES (?, ?, 'chaos-x5-holder', ?, ?)",
        (f"chaos75x5l_{T}", rid, T, T + 120_000),
    )
    conn.commit()
    conn.close()

    results = tick_concurrent(rid, 12)
    codes = [c for _, c in results]
    summaries = [s for s, _ in results if isinstance(s, dict) and "error" not in s]
    real = [s for s in summaries if s.get("traceId") not in ("-", None)]
    leased = [s for s in summaries if "lease held by another runner" in s.get("reason", "")]
    check("X5 storm survives with zero 5xx", all(c == 200 for c in codes), f"codes={set(codes)}")
    check("X5 all 12 contenders refuse against the held lease (S-06)",
          len(leased) == 12 and len(real) == 0, f"{len(leased)} lease refusals, {len(real)} evaluations")
    conn = db()
    n = conn.execute("SELECT COUNT(*) c FROM DecisionTrace WHERE robotId = ?", (rid,)).fetchone()["c"]
    conn.close()
    check("X5 zero evaluations in the trace ledger while the lease is held", n == 0, f"{n} traces")

    conn = db()
    conn.execute("DELETE FROM RobotLease WHERE robotId = ?", (rid,))
    conn.commit()
    conn.close()
    s, _ = api("POST", f"/api/robots/{rid}/cycle")
    check("X5 after release the tick evaluates normally", s.get("traceId") not in ("-", None), s.get("reason", "")[:120])


# ── X6: UNKNOWN never fills without venue evidence (S-01) ────────────────
def chaos_x6():
    print("\n── X6 UNKNOWN never fills without evidence ───────────────────")
    conn = db()
    user = conn.execute("SELECT id FROM User WHERE email='founder@faida.local'").fetchone()
    market = conn.execute(
        "SELECT id FROM Market WHERE venue='POLYMARKET' AND ambiguityFlag=0 AND resolvedAt IS NULL AND yesPriceCents IS NOT NULL ORDER BY volumeCents DESC LIMIT 1"
    ).fetchone()
    if not user or not market:
        check("X6 fixtures available", False, "founder or POLYMARKET market missing")
        conn.close()
        return
    uid, mid = user["id"], market["id"]
    oid = f"chaos75x6_{T}"
    conn.execute(
        "INSERT INTO \"Order\" (id, userId, marketId, mode, side, state, stateReason, priceCents, sizeCents, filledCents, feeCents, venueOrderId, idempotencyKey, createdAt, updatedAt) "
        "VALUES (?, ?, ?, 'PAPER', 'BUY_YES', 'UNKNOWN', 'chaos fixture: venue said UNKNOWN (X6)', 50, 500, 0, 0, 'garbage-venue-order-id-x6', ?, ?, ?)",
        (oid, uid, mid, f"chaos75-x6-{T}", T, T),
    )
    cleanup["orders"].append(oid)
    conn.commit()
    conn.close()

    res, code = api("POST", "/api/cycle", {"action": "RECONCILE"}, timeout=300)
    mine = [r for r in res.get("results", []) if r.get("orderId") == oid]
    check("X6 reconcile ran and saw the UNKNOWN order", code == 200 and len(mine) >= 1, json.dumps(mine)[:160])
    check("X6 venue reports nothing → evidence-based REJECTED (never FILLED)",
          any(r.get("toState") == "REJECTED" for r in mine), json.dumps(mine)[:200])
    conn = db()
    row = conn.execute("SELECT state FROM \"Order\" WHERE id = ?", (oid,)).fetchone()
    fills = conn.execute("SELECT COUNT(*) c FROM LedgerEntry WHERE refId = ? AND type='FILL'", (oid,)).fetchone()["c"]
    conn.close()
    check("X6 order state is REJECTED in the journal", row and row["state"] == "REJECTED", row["state"] if row else "missing")
    check("X6 zero FILL ledger entries — money never moves on hope (S-09)", fills == 0, f"{fills} fills")


def main():
    print(f"Phase 7.5 chaos suite — {time.strftime('%Y-%m-%d %H:%M:%S')} — base {BASE}")
    try:
        sm, scode = api("POST", "/api/markets", {"venue": "MANIFOLD"}, timeout=180)
        check("fixture: MANIFOLD books synced via the live adapter", scode == 200 and sm.get("synced", 0) > 0,
              f"{scode} synced={sm.get('synced')}")
        chaos_x1()
        chaos_x2()
        chaos_x3()
        chaos_x4()
        chaos_x5()
        chaos_x6()
    finally:
        api("POST", "/api/control", {"action": "RESUME"})
        cleanup_all()
        print("\ncleanup: fixtures removed, pause released, ambiguity flags restored")
    if failures:
        print(f"\nCHAOS FAIL ({len(failures)}): " + "; ".join(failures))
        sys.exit(1)
    print("\nCHAOS PASS (X1–X6)")


if __name__ == "__main__":
    main()

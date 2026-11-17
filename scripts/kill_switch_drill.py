#!/usr/bin/env python3
# C19.1 kill-switch drill — a scheduled operational drill, not just a feature
# (carry-forward register: "before Phase 7 and periodically after (7.5)").
# Checklist:
#   K1  pause mid-run: the drill robot's next cycle refuses with the pause
#       reason and the MEASURED propagation from pausedAt (recorded in trace)
#   K2  manual paper order refused while paused (no order-path bypass)
#   K3  manual LIVE order refused while paused (the live path checks pause
#       BEFORE consent/gates — the switch is first)
#   K4  CRITICAL notification + PLATFORM_PAUSED outbox event exist
#   K5  resume restores: cycle runs again, pause state cleared
#   K6  the pause row records who/when/why (audit fields present)
# The drill creates its own robot and removes it on exit (repeatable).
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
failures = []
robot_id = None


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
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        # A refusal IS an expected outcome for most drill steps — the status
        # code + body are the evidence, not an error.
        return {"_status": e.code, **json.loads(e.read().decode() or "{}")}


def db(query, args=()):
    con = sqlite3.connect(DB)
    try:
        return con.execute(query, args).fetchall()
    finally:
        con.close()


def cleanup():
    if not robot_id:
        return
    con = sqlite3.connect(DB)
    try:
        con.execute("DELETE FROM RobotLease WHERE robotId=?", (robot_id,))
        con.execute("DELETE FROM Robot WHERE id=?", (robot_id,))
        con.execute("DELETE FROM StrategyVersion WHERE robotId=?", (robot_id,))
        con.execute("DELETE FROM DecisionTrace WHERE robotId=?", (robot_id,))
        con.execute("DELETE FROM Notification WHERE body LIKE ?", ("%KillSwitch Drill%",))
        con.commit()
    finally:
        con.close()


def main():
    global robot_id
    api("POST", "/api/control", {"action": "RESUME"})
    market = api("GET", "/api/markets")["markets"][0]
    robot = api("POST", "/api/robots", {
        "name": "KillSwitch Drill (C19.1)", "venue": "MANIFOLD", "family": "PROBABILITY_EDGE",
        "allocatedCents": 5000, "maxPositionCents": 500, "maxOpenPositions": 4,
        "config": {"minEdgePts": 60},  # high bar: no-trade unless paused
    })
    robot_id = robot["robot"]["id"]

    # K1 — pause mid-run: the drill robot's next cycle refuses with reason + measured propagation
    api("POST", "/api/control", {"action": "PAUSE", "reason": "C19.1 drill"})
    t0 = time.time()
    summaries = api("POST", "/api/cycle", {"action": "CYCLE"})["summaries"]
    propagation_s = time.time() - t0
    mine = next((s for s in summaries if s["robotId"] == robot_id), None)
    check("K1 cycle refused while paused", mine is not None and mine["decision"] == "NO_TRADE" and "paused" in mine["reason"].lower(), mine["reason"] if mine else "no summary")
    check("K1 refusal carries the drill reason", mine is not None and "C19.1 drill" in mine["reason"], mine["reason"] if mine else "")
    check("K1 measured propagation (<30s wall clock)", propagation_s < 30, f"{propagation_s:.2f}s")
    trace = db("SELECT reason FROM DecisionTrace WHERE robotId=? ORDER BY createdAt DESC LIMIT 1", (robot_id,))[0][0]
    check("K1 trace records measured ms-after-pause", "after pause decision" in trace, trace)

    # K2 — manual paper order refused while paused
    order = api("POST", "/api/orders", {"marketId": market["id"], "side": "BUY_YES", "priceCents": 50, "sizeCents": 100, "nonce": f"ksdrill_{time.time()}"})
    check("K2 manual paper order refused (PLATFORM stage)", order.get("ok") is False and order.get("stage") == "PLATFORM", str(order.get("reason", ""))[:120])

    # K3 — manual LIVE order refused while paused (pause checked FIRST, before gates)
    live = api("POST", "/api/live/orders", {"robotId": robot_id, "marketId": market["id"], "side": "BUY_YES", "priceCents": 50, "sizeCents": 100})
    check("K3 manual live order refused while paused (PLATFORM first)", live.get("ok") is False and live.get("stage") == "PLATFORM", str(live.get("reason", ""))[:120])

    # K4 — CRITICAL notification + outbox event
    # Prisma SQLite stores DateTime as epoch ms — compare integers, not text datetimes
    cut_ms = int((time.time() - 300) * 1000)
    notif = db("SELECT COUNT(*) FROM Notification WHERE severity='CRITICAL' AND family='SYSTEM' AND title LIKE '%kill switch%' AND createdAt > ?", (cut_ms,))[0][0]
    check("K4 CRITICAL notification emitted", notif >= 1, f"{notif} rows")
    outbox = db("SELECT COUNT(*) FROM OutboxEvent WHERE eventType='PLATFORM_PAUSED' AND createdAt > ?", (cut_ms,))[0][0]
    check("K4 PLATFORM_PAUSED outbox event", outbox >= 1, f"{outbox} rows")

    # K6 — pause row records who/when/why
    state = api("GET", "/api/control")["pause"]
    check("K6 pause row audited (by/at/reason)", state.get("paused") is True and state.get("pausedBy") and state.get("pausedAt") and state.get("reason"), json.dumps(state)[:160])

    # K5 — resume restores
    api("POST", "/api/control", {"action": "RESUME"})
    summaries2 = api("POST", "/api/cycle", {"action": "CYCLE"})["summaries"]
    mine2 = next((s for s in summaries2 if s["robotId"] == robot_id), None)
    check("K5 cycle runs again after resume", mine2 is not None and "paused" not in mine2["reason"].lower(), mine2["reason"] if mine2 else "no summary")
    check("K5 pause state cleared", api("GET", "/api/control")["pause"]["paused"] is False)

    cleanup()
    print("cleanup: pause cleared, drill robot removed")
    print()
    if failures:
        print(f"DRILL FAIL — {len(failures)}: {failures}")
        return 1
    print("DRILL PASS — C19.1 kill-switch checklist demonstrated (measured, not asserted)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        cleanup()
        print(f"DRILL ERROR — {e}")
        sys.exit(1)

#!/usr/bin/env python3
# Phase 6 acceptance smoke — Robot Studio completion + Drift BET verdict,
# against the real API stack (dev server reused if healthy, else started here):
#   P6-1 (P-03)  template gallery API: 4 templates across the B6 launch
#                families, full capital/strategy/guidedPath payloads, venues live
#   P6-2 (P-03)  template parity: a robot created from a template payload
#                matches the template's capital, risk stops and strategy knobs
#                in the DB (Robot row + immutable StrategyVersion v1)
#   P6-3 (P-03)  guided session APIs: cycle summaries include the new robot;
#                the first backtest picks a market ON THE ROBOT'S VENUE (B11)
#   P6-4 (A-08)  trace depth data: fresh traces carry riskChecks + provenance
#                JSON and the depth fields (trigger, strategyVersionId)
#   P6-5 (S-05)  Drift BET verdict: robot creation refused 422, compliance row
#                SUSPENDED in code, no template recommends the suspended venue
#   P6-6 (P6.4)  visual regression harness exits 0
# Everything this smoke creates is removed on exit (repeatable).
import json
import sqlite3
import subprocess
import sys
import time
import urllib.request

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
failures = []
robot_id = None
tick_mkt_id = None
ai_scout = None


def check(name, cond, detail=""):
    ok = bool(cond)
    if not ok:
        failures.append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if (not ok and detail) else ""))


def api(method, path, body=None, timeout=180):
    req = urllib.request.Request(
        BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read()), e.code
        except Exception:
            return {}, e.code


def db_query(sql, args=()):
    con = sqlite3.connect(DB)
    rows = con.execute(sql, args).fetchall()
    con.close()
    return rows


def healthy():
    try:
        _, code = api("GET", "/api/health", timeout=5)
        return code == 200
    except Exception:
        return False


# ── reuse a healthy dev server, else start one ───────────────────────────────
server = None
if healthy():
    print("dev server already healthy — reusing it")
else:
    server = subprocess.Popen(
        ["bun", "run", "dev"],
        cwd="/home/z/my-project",
        stdout=open("/tmp/devlog6.txt", "w"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    for _ in range(90):
        time.sleep(1)
        if healthy():
            break
    else:
        print("dev server never became healthy")
        sys.exit(2)
    print("dev server healthy (started by smoke)")

robot_id = None
try:
    # ── P6-1: template gallery (P-03) ────────────────────────────────────────
    tpl, code = api("GET", "/api/robot-templates")
    templates = tpl.get("templates", []) if code == 200 else []
    check("GET /api/robot-templates → 200 with ≥4 templates", code == 200 and len(templates) >= 4, f"got {code}, {len(templates)}")
    families = {t.get("family") for t in templates}
    check("templates cover the B6 launch families", {"PROBABILITY_EDGE", "MARKET_MAKING", "AI_RESEARCH"} <= families, str(families))
    complete = all(
        t.get("capital", {}).get("allocatedCents", 0) > 0
        and all(k in t.get("strategy", {}) for k in ("minEdgePts", "estimatorTiltPct", "exitEdgePts", "holdTicksMax"))
        and len(t.get("guidedPath", [])) >= 3
        and t.get("thesis") and t.get("behavior")
        for t in templates
    )
    check("every template carries capital + strategy knobs + guided path", complete)
    check("every template recommends a LIVE venue (venueLive)", all(t.get("venueLive") for t in templates))
    check("no template recommends a suspended venue", all(t.get("venue") != "DRIFT_BET" for t in templates))
    ai_scout = next((t for t in templates if t["id"] == "ai-scout"), None)
    check("ai-scout template targets MANIFOLD (play money, B9)", ai_scout is not None and ai_scout["venue"] == "MANIFOLD")

    # ── P6-2: template parity — create the AI Scout exactly as the wizard does ──
    payload = {
        "name": ai_scout["nameSuggestion"] + " (smoke)",
        "family": ai_scout["family"],
        "venue": ai_scout["venue"],
        "allocatedCents": ai_scout["capital"]["allocatedCents"],
        "maxPositionCents": ai_scout["capital"]["maxPositionCents"],
        "maxOpenPositions": ai_scout["capital"]["maxOpenPositions"],
        "dailyLossStopPct": ai_scout["capital"]["dailyLossStopPct"],
        "drawdownStopPct": ai_scout["capital"]["drawdownStopPct"],
        "config": {
            "family": ai_scout["family"],
            **ai_scout["strategy"],
            "exitPolicy": "edge_disappears_or_adverse_verified_info",
            "schedule": "continuous",
        },
    }
    created, code = api("POST", "/api/robots", payload)
    robot_id = (created.get("robot") or {}).get("id") if code == 200 else None
    check("template payload creates a PAPER_ONLY robot", code == 200 and robot_id is not None, f"{code} {json.dumps(created)[:120]}")
    if robot_id:
        rows = db_query("SELECT family, venue, status, paperMode, allocatedCents, maxPositionCents, maxOpenPositions, dailyLossStopPct, drawdownStopPct FROM Robot WHERE id=?", (robot_id,))
        r = rows[0] if rows else None
        cap = ai_scout["capital"]
        check("robot row matches template capital + risk stops", r == (
            ai_scout["family"], ai_scout["venue"], "PAPER_ONLY", 1,
            cap["allocatedCents"], cap["maxPositionCents"], cap["maxOpenPositions"],
            cap["dailyLossStopPct"], cap["drawdownStopPct"],
        ), str(r))
        cfg = db_query("SELECT config FROM StrategyVersion WHERE robotId=? AND version=1", (robot_id,))
        v1 = json.loads(cfg[0][0]) if cfg else {}
        st = ai_scout["strategy"]
        check("strategy v1 carries the template's exact knobs (C5)", all(
            v1.get(k) == st[k] for k in ("minEdgePts", "estimatorTiltPct", "exitEdgePts", "holdTicksMax")
        ) and v1.get("entryRule") == st["entryRule"], json.dumps(v1)[:160])

    # ── P6-3: guided session — cycle reaches the robot, backtest stays on venue ──
    # A-05 needs ≥20 recorded ticks; a fresh sandbox DB has none. Write honest
    # SYNTHETIC-labeled history for the most liquid Manifold market (same
    # pattern as the seed's labeled history and smoke_phase5's synthetic
    # evidence), fully removed on exit.
    tick_mkt = db_query(
        "SELECT id, venueSymbol, yesPriceCents FROM Market WHERE venue='MANIFOLD' AND ambiguityFlag=0 AND resolvedAt IS NULL AND yesPriceCents IS NOT NULL ORDER BY volumeCents DESC LIMIT 1"
    )
    tick_mkt_id = tick_mkt[0][0] if tick_mkt else None
    con = sqlite3.connect(DB)
    if tick_mkt_id and tick_mkt[0][2]:
        anchor = int(tick_mkt[0][2])
        rows = []
        for i in range(30):
            wob = ((i * 37) % 9) - 4
            y = max(2, min(98, anchor + wob))
            rows.append((tick_mkt_id, y, max(2, min(98, 100 - y)), "SYNTHETIC"))
        con.executemany(
            "INSERT INTO MarketPriceTick (id, marketId, yesCents, noCents, source, capturedAt) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, datetime('now'))",
            rows,
        )
        con.commit()
        print(f"evidence prep: 30 SYNTHETIC-labeled ticks written for {tick_mkt[0][1]} (removed on exit)")
    con.close()
    cyc, code = api("POST", "/api/cycle", {"action": "CYCLE"}, timeout=300)
    summaries = cyc.get("summaries", []) if code == 200 else []
    reached = any(s.get("robotId") == robot_id for s in summaries)
    check("cycle summaries include the template robot (guided step 2 wiring)", reached and robot_id is not None)
    bt, code = api("POST", "/api/backtests", {"robotId": robot_id}, timeout=120)
    run_id = bt.get("runId") if isinstance(bt, dict) else None
    check("first backtest completes (guided step 3 wiring)", code == 200 and bt.get("ok") is True and run_id, f"{code} {json.dumps(bt)[:120]}")
    if run_id:
        venue_rows = db_query("SELECT m.venue FROM BacktestRun b JOIN Market m ON m.id=b.marketId WHERE b.id=?", (run_id,))
        check("backtest default market is on the robot's venue (B11)", venue_rows and venue_rows[0][0] == ai_scout["venue"], str(venue_rows))

    # ── P6-4: A-08 trace depth data ──────────────────────────────────────────
    dash, code = api("GET", "/api/dashboard")
    traces = dash.get("traces", []) if code == 200 else []
    check("dashboard exposes fresh traces", code == 200 and len(traces) > 0, f"{code}, {len(traces)}")
    with_provenance = [t for t in traces if t.get("provenance")]
    prov_ok = False
    if with_provenance:
        p = json.loads(with_provenance[0]["provenance"])
        prov_ok = bool(p.get("modelKey")) and bool(p.get("evidenceHash")) and p.get("screening") in ("PASS", "FLAGGED")
    check("traces carry parseable provenance envelopes (A-02)", prov_ok)
    checks_ok = False
    if traces:
        rc = json.loads(traces[0]["riskChecks"]) if traces[0].get("riskChecks") else []
        checks_ok = len(rc) > 0 and all(("check" in c and "passed" in c and "detail" in c) for c in rc)
    check("traces carry parseable risk-check arrays with verdicts", checks_ok)
    depth_fields = all(t.get("trigger") is not None for t in traces if traces) if traces else False
    depth_fields = depth_fields and any(t.get("strategyVersionId") for t in traces)
    check("trace payload includes depth fields (trigger, strategyVersionId)", depth_fields)

    # ── P6-5: Drift BET verdict (S-05 [VERIFY] before adapter) ───────────────
    _, code = api("POST", "/api/robots", {"name": "drift probe", "family": "PROBABILITY_EDGE", "venue": "DRIFT_BET"})
    check("DRIFT_BET robot creation refused 422 (no live adapter)", code == 422)
    src_types = open("/home/z/my-project/src/lib/venue/types.ts").read()
    src_venues = open("/home/z/my-project/src/lib/venues.ts").read()
    check("compliance row: DRIFT_BET SUSPENDED with dated [VERIFY] evidence",
          'venue: "DRIFT_BET"' in src_types and 'status: "SUSPENDED"' in src_types and "2026-11-18" in src_types)
    check("registry note names the exploit + deliberately-not-built verdict",
          "SUSPENDED" in src_venues and "April 2026 Drift exploit" in src_venues and "deliberately not built" in src_venues)

    # ── P6-6: visual regression harness ──────────────────────────────────────
    vr = subprocess.run(["bun", "run", "visual"], cwd="/home/z/my-project", capture_output=True, text=True, timeout=300)
    tail = "\n".join(vr.stdout.strip().splitlines()[-3:])
    check("visual regression exits 0 (pixel + DOM modes)", vr.returncode == 0, tail[:220])

finally:
    if robot_id:
        con = sqlite3.connect(DB)
        oids = [r[0] for r in con.execute('SELECT id FROM "Order" WHERE robotId=?', (robot_id,)).fetchall()]
        for oid in oids:
            con.execute("DELETE FROM Fill WHERE orderId=?", (oid,))
            con.execute("DELETE FROM OrderEvent WHERE orderId=?", (oid,))
            con.execute("DELETE FROM ReconciliationEntry WHERE orderId=?", (oid,))
        con.execute('DELETE FROM "Order" WHERE robotId=?', (robot_id,))
        con.execute("DELETE FROM Position WHERE robotId=?", (robot_id,))
        con.execute("DELETE FROM DecisionTrace WHERE robotId=?", (robot_id,))
        con.execute("DELETE FROM BacktestRun WHERE robotId=?", (robot_id,))
        con.execute("DELETE FROM StrategyVersion WHERE robotId=?", (robot_id,))
        con.execute("DELETE FROM Notification WHERE title LIKE ?", (f"%{(ai_scout['nameSuggestion'] if ai_scout else 'Scout')}%",))
        con.execute("DELETE FROM Robot WHERE id=?", (robot_id,))
        if tick_mkt_id:
            con.execute("DELETE FROM MarketPriceTick WHERE marketId=? AND source='SYNTHETIC'", (tick_mkt_id,))
        con.commit()
        con.close()
        print("cleanup: template robot + synthetic tick evidence removed")
    if server:
        server.terminate()
        try:
            server.wait(5)
        except Exception:
            server.kill()

print()
if failures:
    print(f"SMOKE FAIL — {len(failures)}: {failures}")
    sys.exit(1)
print("SMOKE PASS — Phase 6 acceptance criteria demonstrated")

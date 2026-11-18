#!/usr/bin/env python3
# A-01 demotion drill — Phase 5 closing criterion ("demotion drills pass
# before this phase closes"). Drives the FULL governance round trip through
# the real API stack:
#   1. synthetic resolved evidence makes the GLM candidate calibration-eligible
#   2. PROMOTE → GLM becomes ACTIVE, baseline steps down to the floor
#   3. a corrupted recent window (estimates opposite of outcomes) is injected
#   4. RECOMPUTE flags `demote`; CHECK_DEMOTION demotes GLM → baseline returns
#   5. notifications (MODEL_GOVERNANCE) + outbox (MODEL_DEMOTED) recorded
# Evidence is created directly in the DB with honest DEMO_SNAPSHOT labeling
# (D-03) and fully removed on exit so the drill is repeatable.
import json
import sqlite3
import sys
import time
import urllib.request

BASE = "http://localhost:3000"
DB = "db/custom.db"
GLM_KEY = "ai:GLM/glm-4.6"
failures = []


def check(name, cond, detail=""):
    ok = bool(cond)
    if not ok:
        failures.append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if (not ok and detail) else ""))


def api(method, path, body=None, timeout=120):
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


class Drill:
    def __init__(self):
        self.db = sqlite3.connect(DB)
        self.t = int(time.time())
        self.market_ids = []
        self.robot_id = "drill_robot_" + str(self.t)
        self.glm_id = None
        self.glm_enabled_orig = None
        self.glm_budget_orig = None

    def founder_id(self):
        return self.db.execute("SELECT id FROM User WHERE email='founder@faida.local'").fetchone()[0]

    def seed_promotion_evidence(self, n=36):
        # markets the book got WRONG, the model got right: outcome YES on
        # low-price books. Baseline (fade toward 50) scores brier ≈ 0.45;
        # the model's near-certain correct calls score ≈ 0.0025.
        uid = self.founder_id()
        self.db.execute(
            "INSERT INTO Robot (id,userId,name,family,venue,status,statusReason,paperMode,allocatedCents,maxPositionCents,maxOpenPositions,dailyLossStopPct,drawdownStopPct,activeVersion,createdAt,updatedAt) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (self.robot_id, uid, "Governance Drill Robot", "PROBABILITY_EDGE", "POLYMARKET", "PAUSED_BY_USER", "A-01 demotion drill (cycles skip it)", 1, 100000, 10000, 4, 5, 10, 1, 1767225600000, 1767225600000),
        )
        for i in range(n):
            mid = f"drill_mkt_{self.t}_{i}"
            p = 10 + (i * 37) % 35  # 10..44 — book implies NO
            outcome = "YES"
            self.market_ids.append((mid, p, outcome))
            self.db.execute(
                "INSERT INTO Market (id,venue,venueSymbol,question,category,ambiguityFlag,resolutionSource,dataSource,resolvedAt,resolutionOutcome,createdAt,updatedAt) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (mid, "POLYMARKET", f"drill-{self.t}-{i}", f"[DRILL] synthetic resolved market #{i} (DEMO_SNAPSHOT)", "drill", 0, "drill-runbook", "DEMO_SNAPSHOT", "2026-01-02T00:00:00.000Z", outcome, 1767225600000, 1767225600000),
            )
            self.insert_trace(mid, p, outcome, good=True, seq=i)

    def seed_demotion_window(self, n=30):
        # corrupted recent window: estimates opposite of outcomes
        for i in range(n):
            mid = f"drill_mkt_bad_{self.t}_{i}"
            p = 55 + (i * 23) % 30  # 55..84 — book implies YES
            outcome = "NO"
            self.market_ids.append((mid, p, outcome))
            self.db.execute(
                "INSERT INTO Market (id,venue,venueSymbol,question,category,ambiguityFlag,resolutionSource,dataSource,resolvedAt,resolutionOutcome,createdAt,updatedAt) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (mid, "POLYMARKET", f"drill-bad-{self.t}-{i}", f"[DRILL] synthetic corrupted-window market #{i} (DEMO_SNAPSHOT)", "drill", 0, "drill-runbook", "DEMO_SNAPSHOT", "2026-01-03T00:00:00.000Z", outcome, 1767225600000, 1767225600000),
            )
            self.insert_trace(mid, p, outcome, good=False, seq=100 + i)

    def insert_trace(self, market_id, price, outcome, good, seq):
        est = (95 if outcome == "YES" else 5) if good else (5 if outcome == "YES" else 95)
        prov = json.dumps({
            "modelKey": GLM_KEY, "kind": "AI", "provider": "GLM", "model": "glm-4.6",
            "latencyMs": 800, "cache": "NONE", "evidenceHash": f"ev_drill{self.t}{seq}",
            "screening": "PASS", "estimatorVersion": GLM_KEY,
        })
        created = self.t * 1000 - 3600 * 1000 + seq * 1000
        self.db.execute(
            "INSERT INTO DecisionTrace (id,robotId,marketId,trigger,modelEstimatePct,marketPriceCents,edgeNetPct,decision,reason,riskChecks,modelKey,provenance,createdAt) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"drill_tr_{self.t}_{seq}", self.robot_id, market_id, "SCHEDULE_TICK", est, price, 10 if good else -30,
             "TRADE" if good else "NO_TRADE", f"drill trace (good={good}) on {market_id}", "[]", GLM_KEY, prov, created),
        )

    def model_row(self, key):
        row = self.db.execute("SELECT status, calibration FROM ProbabilityModel WHERE key=?", (key,)).fetchone()
        return {"status": row[0], "calibration": json.loads(row[1]) if row[1] else None}

    def cleanup(self, restore_status):
        # children first — a drill robot that ever traded leaves orders/positions
        self.db.execute("DELETE FROM DecisionTrace WHERE robotId=?", (self.robot_id,))
        for (mid, _, _) in self.market_ids:
            self.db.execute("DELETE FROM DecisionTrace WHERE marketId=?", (mid,))
        oids = [r[0] for r in self.db.execute('SELECT id FROM "Order" WHERE robotId=?', (self.robot_id,)).fetchall()]
        for oid in oids:
            self.db.execute("DELETE FROM Fill WHERE orderId=?", (oid,))
            self.db.execute("DELETE FROM OrderEvent WHERE orderId=?", (oid,))
            self.db.execute("DELETE FROM ReconciliationEntry WHERE orderId=?", (oid,))
        self.db.execute('DELETE FROM "Order" WHERE robotId=?', (self.robot_id,))
        self.db.execute("DELETE FROM Position WHERE robotId=?", (self.robot_id,))
        for (mid, _, _) in self.market_ids:
            self.db.execute("DELETE FROM MarketPriceTick WHERE marketId=?", (mid,))
            self.db.execute("DELETE FROM Market WHERE id=?", (mid,))
        self.db.execute("DELETE FROM Robot WHERE id=?", (self.robot_id,))
        self.db.execute("UPDATE ProbabilityModel SET status=?, calibration=NULL WHERE key=?", (restore_status, GLM_KEY))
        self.db.execute("UPDATE ProbabilityModel SET status='ACTIVE' WHERE key='heuristic-contrarian-v1'")
        self.db.commit()
        if self.glm_id:
            for _r in range(3):
                res, code = api("PUT", "/api/settings/ai", {"id": self.glm_id, "enabled": bool(self.glm_enabled_orig), "monthlyBudgetCents": self.glm_budget_orig})
                if code == 200 and res.get("ok"):
                    break
                time.sleep(1)
            else:
                print(f"WARN: provider restore PUT failed: {code} {json.dumps(res)[:140]}")

    def commit(self):
        self.db.commit()


def main():
    for _ in range(60):
        try:
            _, code = api("GET", "/api/health", timeout=5)
            if code == 200:
                break
        except Exception:
            time.sleep(1)
    else:
        print("dev server never became healthy")
        sys.exit(2)
    print("dev server healthy")

    # belt-and-braces: purge orphans a crashed earlier run may have left
    _c = sqlite3.connect(DB)
    _oids = [r[0] for r in _c.execute('SELECT id FROM "Order" WHERE robotId NOT IN (SELECT id FROM Robot)').fetchall()]
    for _oid in _oids:
        _c.execute("DELETE FROM Fill WHERE orderId=?", (_oid,))
        _c.execute("DELETE FROM OrderEvent WHERE orderId=?", (_oid,))
        _c.execute("DELETE FROM ReconciliationEntry WHERE orderId=?", (_oid,))
    _c.execute('DELETE FROM "Order" WHERE robotId NOT IN (SELECT id FROM Robot)')
    _c.execute("DELETE FROM Position WHERE robotId NOT IN (SELECT id FROM Robot)")
    _c.commit()
    _c.close()

    drill = Drill()
    glm_before = drill.db.execute("SELECT status FROM ProbabilityModel WHERE key=?", (GLM_KEY,)).fetchone()
    restore = glm_before[0] if glm_before else "CANDIDATE"
    print(f"GLM status before drill: {restore}")

    try:
        # ── 1. promotion evidence ────────────────────────────────────────────
        drill.seed_promotion_evidence()
        drill.commit()
        _, _ = api("POST", "/api/probability", {"action": "RECOMPUTE"}, timeout=180)
        row = drill.model_row(GLM_KEY)
        cal = row["calibration"]
        print(f"after promotion evidence: status={row['status']} n={cal['n'] if cal else 0} brier={cal['brier']:.4f} baseline={cal['baselineBrier']:.4f} eligible={cal['eligible']}" if cal else "no calibration")
        check("promotion evidence makes GLM eligible", cal is not None and cal["eligible"] is True and cal["n"] >= 30, json.dumps(cal)[:160] if cal else "none")
        check("model brier beats baseline", cal is not None and cal["brier"] < cal["baselineBrier"] * 0.95)
        check("synthetic evidence honestly labeled (D-03)", cal is not None and cal["nSynthetic"] >= 30 and cal["nLive"] == 0)

        # ── 2. PROMOTE through the API (founder action, B8) ─────────────────
        # the registry refuses to promote a disabled provider's model — enable first
        glm_row = drill.db.execute("SELECT id, enabled, monthlyBudgetCents FROM AiProvider WHERE name='GLM'").fetchone()
        drill.glm_id, drill.glm_enabled_orig, drill.glm_budget_orig = glm_row
        api("PUT", "/api/settings/ai", {"id": drill.glm_id, "enabled": True})
        res, code = api("POST", "/api/probability", {"action": "PROMOTE", "modelKey": GLM_KEY})
        check("promote accepted", code == 200 and res.get("ok") is True, json.dumps(res)[:160])
        row = drill.model_row(GLM_KEY)
        check("GLM is ACTIVE after promotion", row["status"] == "ACTIVE", row["status"])
        base = drill.model_row("heuristic-contrarian-v1")
        check("baseline stepped down to the floor (CANDIDATE)", base["status"] == "CANDIDATE", base["status"])

        # ── 3. corrupted recent window → demotion ───────────────────────────
        drill.seed_demotion_window()
        drill.commit()
        api("POST", "/api/probability", {"action": "RECOMPUTE"}, timeout=180)
        row = drill.model_row(GLM_KEY)
        cal = row["calibration"]
        check("recompute flags demotion on the corrupted window", cal is not None and cal["demote"] is True, json.dumps({k: cal[k] for k in ('brier', 'baselineBrier', 'demote')} if cal else {})[:160])

        res, code = api("POST", "/api/probability", {"action": "CHECK_DEMOTION"})
        check("CHECK_DEMOTION demotes the degraded model", code == 200 and res.get("demoted") == GLM_KEY, json.dumps(res)[:200])
        row = drill.model_row(GLM_KEY)
        check("GLM is DEMOTED", row["status"] == "DEMOTED", row["status"])
        base = drill.model_row("heuristic-contrarian-v1")
        check("baseline is ACTIVE again after demotion", base["status"] == "ACTIVE", base["status"])

        # ── 4. audit trail: notification + outbox (direct DB, short retry) ──
        dem_note = None
        ob = 0
        for _ in range(10):
            notes = drill.db.execute(
                "SELECT title FROM Notification WHERE family='MODEL_GOVERNANCE' AND severity='WARNING' AND title LIKE '%demoted%'"
            ).fetchall()
            dem_note = notes[0] if notes else None
            ob = drill.db.execute("SELECT COUNT(*) FROM OutboxEvent WHERE eventType='MODEL_DEMOTED'").fetchone()[0]
            if dem_note and ob >= 1:
                break
            time.sleep(1)
        check("MODEL_GOVERNANCE notification recorded", dem_note is not None, f"{len(dem_note) if dem_note else 0} matching rows")
        check("MODEL_DEMOTED outbox event recorded", ob >= 1, f"{ob} rows")

        # ── 5. cycles now estimate with the baseline again ──────────────────
        pm, _ = api("POST", "/api/markets", {"venue": "POLYMARKET"}, timeout=120)
        cyc, _ = api("POST", "/api/cycle", {"action": "CYCLE"}, timeout=180)
        summaries = [s for s in cyc.get("summaries", []) if s.get("traceId", "-") != "-"]
        trace_id = summaries[0]["traceId"] if summaries else None
        key = None
        if trace_id:
            row = drill.db.execute("SELECT modelKey FROM DecisionTrace WHERE id=?", (trace_id,)).fetchone()
            key = row[0] if row else None
        check("post-demotion cycle estimates with the baseline", key == "heuristic-contrarian-v1", f"trace {trace_id}: modelKey={key}")

    finally:
        drill.cleanup(restore)
        api("POST", "/api/probability", {"action": "RECOMPUTE"}, timeout=180)
        row = drill.model_row(GLM_KEY)
        print(f"cleanup: GLM restored to {row['status']}, drill evidence removed")

    print()
    if failures:
        print(f"DRILL FAIL — {len(failures)}: {failures}")
        sys.exit(1)
    # Phase 10: stamp the exit-bar drill timestamp (best-effort).
    try:
        import json as _json, urllib.request as _urq
        _r = _urq.Request(BASE + '/api/beta/drill-marker', method='POST',
                          data=_json.dumps({'kind': 'RUNBOOK_DRILL'}).encode(),
                          headers={'Content-Type': 'application/json'})
        _urq.urlopen(_r, timeout=30).read()
    except Exception:
        pass
    print("DRILL PASS — A-01 demotion path verified end to end")


if __name__ == "__main__":
    main()

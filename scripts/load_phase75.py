#!/usr/bin/env python3
# Phase 7.5 load protocol — measures the B5 operational targets (carry-forward
# register: "latency p95 + load measured in 7.5"):
#   B5-1  500 concurrent robots   — N per-robot ticks driven concurrently
#         through the real API (POST /api/robots/{id}/cycle, S-06 leases make
#         this safe); every robot must complete a tick, zero 5xx
#   B5-2  decision latency ≤ 750 ms p95 — per-request round trip measured
#         client-side at the configured scheduler concurrency
#   B5-3  availability ≥ 99.5%    — /api/health probed every 500 ms across the
#         whole load window; availability = successful probes / total
# Book freshness is refreshed through the REAL venue sync before the run so the
# S-10 staleness gate passes on live data (never faked — D-03).
# Usage:
#   python3 scripts/load_phase75.py --robots 500 --concurrency 16   # full B5 run
#   python3 scripts/load_phase75.py --quick                         # smoke variant
# Everything (robots, traces, ticks, orders, outbox rows) is removed on exit.
# Honest labeling (D-03): measured on the sandbox dev server (Next dev, SQLite);
# the founder-host production re-run is owed before the live pilot scales up.
import argparse
import json
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "http://localhost:3000"
DB = str(Path(__file__).resolve().parent.parent / "db" / "custom.db")
T = int(time.time() * 1000)
failures = []


def check(name, cond, detail=""):
    ok = bool(cond)
    if not ok:
        failures.append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if (not ok and detail) else ""))


def api(method, path, body=None, timeout=300):
    req = urllib.request.Request(BASE + path, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode()), r.status, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode()), e.code, (time.perf_counter() - t0) * 1000
        except Exception:
            return {}, e.code, (time.perf_counter() - t0) * 1000
    except Exception:
        return {}, 0, (time.perf_counter() - t0) * 1000


def percentile(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    k = min(len(sorted_vals) - 1, max(0, int(round((p / 100) * (len(sorted_vals) - 1)))))
    return sorted_vals[k]


def cleanup_all():
    conn = sqlite3.connect(DB, timeout=60)
    rows = conn.execute("SELECT id FROM Robot WHERE name LIKE 'Load75-%'").fetchall()
    for (rid,) in rows:
        conn.execute("DELETE FROM RobotLease WHERE robotId = ?", (rid,))
        conn.execute("DELETE FROM DecisionTrace WHERE robotId = ?", (rid,))
        conn.execute("DELETE FROM OutboxEvent WHERE aggregateType='ROBOT' AND aggregateId = ?", (rid,))
        conn.execute("DELETE FROM StrategyVersion WHERE robotId = ?", (rid,))
        conn.execute("DELETE FROM Robot WHERE id = ?", (rid,))
    orders = conn.execute(
        "SELECT o.id FROM \"Order\" o JOIN Robot r ON o.robotId = r.id WHERE r.name LIKE 'Load75-%'"
    ).fetchall()
    for (oid,) in orders:
        conn.execute("DELETE FROM ReconciliationEntry WHERE orderId = ?", (oid,))
        conn.execute("DELETE FROM OrderEvent WHERE orderId = ?", (oid,))
        conn.execute("DELETE FROM Fill WHERE orderId = ?", (oid,))
        conn.execute("DELETE FROM LedgerEntry WHERE refId = ?", (oid,))
        conn.execute("DELETE FROM \"Order\" WHERE id = ?", (oid,))
    conn.execute("DELETE FROM MarketPriceTick WHERE capturedAt >= ?", (T - 1000,))
    conn.commit()
    conn.close()
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--robots", type=int, default=500)
    ap.add_argument("--concurrency", type=int, default=16, help="scheduler concurrency (B5-2 measured at this level)")
    ap.add_argument("--quick", action="store_true", help="smoke variant: 24 robots, concurrency 8")
    args = ap.parse_args()
    if args.quick:
        args.robots, args.concurrency = 24, 8

    print(f"Phase 7.5 load protocol — {time.strftime('%Y-%m-%d %H:%M:%S')} — {args.robots} robots @ concurrency {args.concurrency} — base {BASE}")
    created = 0
    try:
        # fixture: refresh books via the real sync API (S-10 passes on live data)
        sm, scode, _ = api("POST", "/api/markets", {"venue": "MANIFOLD"}, timeout=180)
        check("fixture: MANIFOLD books synced via the live adapter", scode == 200 and sm.get("synced", 0) > 0,
              f"{scode} synced={sm.get('synced')}")

        # seed N robots through the real wizard API (Robot + StrategyVersion v1).
        # Modest seed concurrency + bounded retries: SQLite serializes writers and
        # Prisma raises on contention — the load target is the TICK path (B5), not
        # the wizard's write fan-out.
        def create_robot(i):
            for attempt in range(4):
                body, code, ms = api("POST", "/api/robots", {
                    "name": f"Load75-{i} {T}", "venue": "MANIFOLD", "family": "PROBABILITY_EDGE",
                    "allocatedCents": 5000, "maxPositionCents": 500, "maxOpenPositions": 4,
                }, timeout=120)
                if code == 200 and body.get("robot", {}).get("id"):
                    return body, code, ms
                time.sleep(1.0 + attempt)
            return body, code, ms

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=6) as ex:
            res = list(ex.map(create_robot, range(args.robots)))
        robot_ids = [r.get("robot", {}).get("id") for r, c, _ in res if c == 200 and r.get("robot", {}).get("id")]
        created = len(robot_ids)
        seed_s = time.perf_counter() - t0
        bad = [json.dumps(r)[:160] for r, c, _ in res if c != 200]
        check(f"B5 seed: {args.robots} robots created via the wizard API", created == args.robots,
              f"{created}/{args.robots} created in {seed_s:.1f}s; codes={sorted(set(c for _, c, _ in res))}" + (f"; sample error: {bad[0]}" if bad else ""))

        # availability probe thread across the whole load window
        health = {"ok": 0, "total": 0}
        probing = threading.Event()
        probing.set()

        def probe():
            while probing.is_set():
                _, code, _ = api("GET", "/api/health", timeout=15)
                health["total"] += 1
                if code == 200:
                    health["ok"] += 1
                time.sleep(0.5)

        probe_thread = threading.Thread(target=probe, daemon=True)
        probe_thread.start()

        # the load: concurrent per-robot ticks through the real API
        tick_results = []
        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            futures = [ex.submit(api, "POST", f"/api/robots/{rid}/cycle") for rid in robot_ids]
            for f in futures:
                tick_results.append(f.result())
        wall = time.perf_counter() - t0
        probing.clear()
        probe_thread.join(timeout=2)

        lat = sorted(ms for _, _, ms in tick_results)
        codes = {}
        decisions = {}
        for s, c, _ in tick_results:
            codes[c] = codes.get(c, 0) + 1
            if isinstance(s, dict) and s.get("decision"):
                decisions[s["decision"]] = decisions.get(s["decision"], 0) + 1
        p50, p95, p99 = percentile(lat, 50), percentile(lat, 95), percentile(lat, 99)
        err5xx = sum(v for k, v in codes.items() if k >= 500)
        availability = (health["ok"] / health["total"] * 100) if health["total"] else 0.0
        ticked = sum(1 for s, _, _ in tick_results if isinstance(s, dict) and s.get("traceId") not in ("-", None))
        traces = 0
        refused_pause = 0
        conn = sqlite3.connect(DB, timeout=60)
        try:
            traces = conn.execute("SELECT COUNT(*) FROM DecisionTrace WHERE robotId IN (SELECT id FROM Robot WHERE name LIKE 'Load75-%')").fetchone()[0]
        finally:
            conn.close()

        print(f"\n  decisions: {decisions}; traces written: {traces}; robots that produced a real trace: {ticked}")
        print(f"  latency ms — p50 {p50:.0f} | p95 {p95:.0f} | p99 {p99:.0f} | max {lat[-1] if lat else 0:.0f} (scheduler concurrency {args.concurrency})")
        print(f"  throughput: {args.robots / wall:.1f} robots/s ({wall:.1f}s wall for {args.robots} ticks); status codes: {codes}")
        print(f"  availability during window: {availability:.2f}% ({health['ok']}/{health['total']} health probes)")

        check("B5-1 capacity: every robot completed exactly one tick, zero 5xx",
              created == args.robots and ticked >= args.robots and err5xx == 0,
              f"ticked={ticked}/{args.robots}, 5xx={err5xx}")
        check("B5-2 decision latency p95 ≤ 750 ms at scheduler concurrency",
              p95 <= 750, f"p95={p95:.0f}ms p50={p50:.0f}ms (dev-server, sandbox)")
        check("B5-3 availability ≥ 99.5% across the load window",
              availability >= 99.5, f"{availability:.2f}%")
        check("B5 trace completeness: every tick left a DecisionTrace (A-08)",
              traces >= ticked, f"traces={traces} vs ticked={ticked}")
    finally:
        removed = cleanup_all()
        print(f"\ncleanup: {removed} load robots + their traces/orders/ticks removed")
    if failures:
        print(f"\nLOAD FAIL ({len(failures)}): " + "; ".join(failures))
        sys.exit(1)
    print("\nLOAD PASS (B5 protocol)")


if __name__ == "__main__":
    main()

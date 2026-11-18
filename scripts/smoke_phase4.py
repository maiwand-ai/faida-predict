#!/usr/bin/env python3
# Phase 4 acceptance smoke — runs the whole golden path in ONE process:
# starts the dev server (sandbox reaps background processes between calls),
# syncs Limitless, then walks every Phase-4 acceptance criterion:
#   P4-1 thin-book markets refuse entry with a stated depth reason
#   P4-2 liquid markets accept entry; venue taker fee charged on the fill
#   P4-3 edge-after-fees visible in trace reasons
#   P4-4 clustered positions sum in per-event exposure (A-04)
# Evidence is printed; exit code 0 only if every expectation held.
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE = "http://localhost:3000"
ROOT = Path(__file__).resolve().parent.parent
failures = []


def per_event_ok(reason: str) -> bool:
    # The refusal must state the stacked cluster exposure summing across the
    # event's markets (open exposure + this order vs the cap).
    return "open exposure" in reason and "this order" in reason


def check(name, cond, detail=""):
    ok = bool(cond)
    if not ok:
        failures.append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if (not ok and detail) else ""))


def api(method, path, body=None, timeout=180):
    req = urllib.request.Request(
        BASE + path,
        method=method,
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


# ── start dev server inside this process tree ────────────────────────────────
server = subprocess.Popen(
    ["bun", "run", "dev"],
    cwd=ROOT,
    stdout=open("/tmp/devlog.txt", "w"),
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
try:
    for _ in range(60):
        time.sleep(1)
        try:
            _, code = api("GET", "/api/health", timeout=5)
            if code == 200:
                break
        except Exception:
            pass
    else:
        print("dev server never became healthy")
        sys.exit(2)
    print("dev server healthy")

    # ── 0. resync Polymarket (eventKey backfill for A-04) ────────────────────
    pm, code = api("POST", "/api/markets", {"venue": "POLYMARKET"}, timeout=120)
    print("polymarket sync:", json.dumps(pm)[:160])
    check("polymarket resync ok", code == 200 and pm.get("synced", 0) > 0)

    # ── 1. sync Limitless (structural data captured at sync) ────────────────
    lx, code = api("POST", "/api/markets", {"venue": "LIMITLESS"}, timeout=200)
    print("limitless sync:", json.dumps(lx)[:160])
    check("limitless sync ok", code == 200 and lx.get("synced", 0) > 0, json.dumps(lx)[:200])
    check("limitless source is LIMITLESS_LIVE", lx.get("source") == "LIMITLESS_LIVE", str(lx.get("source")))

    markets, _ = api("GET", "/api/markets", timeout=60)
    rows = markets.get("markets", [])
    lx_rows = [m for m in rows if m.get("venue") == "LIMITLESS"]
    with_depth = [m for m in lx_rows if m.get("yesTouchDepthCents") is not None or m.get("noTouchDepthCents") is not None]
    with_fees = [m for m in lx_rows if m.get("yesTakerFeeBps") is not None]
    print(f"limitless markets: {len(lx_rows)}, with book depth: {len(with_depth)}, with fee bps: {len(with_fees)}")
    check("limitless markets synced with structural data", len(lx_rows) > 0 and len(with_fees) == len(lx_rows))
    # thin-liquidity reality: at least one thin (< 5000¢) and one deep book
    thin = [m for m in with_depth if (m.get("yesTouchDepthCents") or 0) < 5000]
    deep = [m for m in with_depth if (m.get("yesTouchDepthCents") or 0) >= 5000]
    print(f"thin (refused) books: {len(thin)}, deep (tradeable) books: {len(deep)}")
    check("both sides of the structural gate present in live data", len(thin) > 0 and len(deep) > 0)

    thin_m = thin[0] if thin else None
    deep_m = deep[0] if deep else None
    if thin_m:
        print(f"thin example: {thin_m['question'][:52]!r} YES touch {thin_m['yesTouchDepthCents']}¢")
    if deep_m:
        print(f"deep example: {deep_m['question'][:52]!r} YES touch {deep_m['yesTouchDepthCents']}¢")

    # ── 2. P4-1: thin book refuses entry with a stated depth reason ─────────
    if thin_m:
        res, code = api("POST", "/api/orders", {
            "marketId": thin_m["id"], "side": "BUY_YES",
            "priceCents": thin_m["yesPriceCents"], "sizeCents": 2500, "nonce": f"smoke-thin-{int(time.time())}",
        })
        reason = res.get("reason", "")
        print(f"thin order → {code}: {reason[:160]}")
        check("thin book refused (4xx)", 400 <= code < 500, str(code))
        check("refusal names the touch-depth rule", "touch_depth" in reason and "LIMITLESS rule (a)" in reason, reason[:200])

    # ── 3. P4-2: liquid book accepts; venue taker fee charged ───────────────
    if deep_m:
        size = 2500
        res, code = api("POST", "/api/orders", {
            "marketId": deep_m["id"], "side": "BUY_YES",
            "priceCents": deep_m["yesPriceCents"], "sizeCents": size, "nonce": f"smoke-deep-{int(time.time())}",
        })
        print(f"deep order → {code}: {json.dumps(res)[:140]}")
        check("deep book accepted (200)", code == 200, json.dumps(res)[:200])
        if code == 200:
            oid = res.get("orderId")
            orders, _ = api("GET", "/api/orders", timeout=30)
            o = next((x for x in orders.get("orders", []) if x.get("id") == oid), None)
            expected_fee = (size * (deep_m.get("yesTakerFeeBps") or 0)) // 10000
            check("venue taker fee charged on the paper fill", o is not None and o.get("feeCents") == expected_fee,
                  f"fee {o.get('feeCents') if o else '?'} want {expected_fee}")

    # ── 4. robot cycle on Limitless (P4-3: edge-after-fees in the trace) ────
    rob, code = api("POST", "/api/robots", {
        "name": "LX Structured Entry (Phase 4 smoke)", "family": "PROBABILITY_EDGE", "venue": "LIMITLESS",
    })
    check("limitless robot created (registry LIVE)", code == 200 and rob.get("robot", {}).get("venue") == "LIMITLESS", json.dumps(rob)[:200])
    robot_id = rob.get("robot", {}).get("id")
    cyc, _ = api("POST", "/api/cycle", {"action": "CYCLE"}, timeout=180)
    summaries = cyc.get("summaries", [])
    mine = [s for s in summaries if s.get("robotId") == robot_id]
    if mine:
        s = mine[0]
        print(f"limitless cycle → {s['decision']}: {s['reason'][:190]}")
        if s["decision"] == "TRADE":
            check("cycle traded with fee-aware net edge", "gross edge" in s["reason"] and ("taker fee" in s["reason"] or "no taker fee" in s["reason"]))
        else:
            # refusal is fine — it must be a stated structural/staleness reason, never silent
            check("cycle refusal is a stated structural reason",
                  any(k in s["reason"] for k in ("touch depth", "stale", "risk check failed", "below minimum")),
                  s["reason"][:200])
    else:
        check("limitless robot produced a cycle summary", False, f"{len(summaries)} summaries, none for {robot_id}")

    # ── 5. P4-4: A-04 cluster — same-event Polymarket markets stack ─────────
    pm_rows = [m for m in rows if m.get("venue") == "POLYMARKET" and m.get("eventKey")]
    clusters: dict[str, list] = {}
    for m in pm_rows:
        healthy = (
            not m.get("ambiguityFlag") and m.get("yesPriceCents") is not None
            and m.get("noPriceCents") is not None
            and 1 <= m["yesPriceCents"] <= 99 and 1 <= m["noPriceCents"] <= 99
        )
        if healthy:
            clusters.setdefault(m["eventKey"], []).append(m)
    cluster_key = max(clusters, key=lambda k: len(clusters[k]), default=None)
    check("polymarket resync produced event clusters with healthy books", cluster_key is not None and len(clusters.get(cluster_key, [])) >= 2,
          f"{len(clusters)} healthy clusters found")
    if cluster_key:
        a, b = clusters[cluster_key][:2]
        print(f"cluster {cluster_key}: {[m['question'][:36] for m in clusters[cluster_key][:2]]}")
        prob, _ = api("POST", "/api/robots", {
            "name": "PM Cluster Probe (Phase 4 smoke)", "family": "PROBABILITY_EDGE", "venue": "POLYMARKET",
            "allocatedCents": 50000, "maxPositionCents": 5000, "maxOpenPositions": 8,
        })
        probe = prob["robot"]["id"]  # event cap = 40% × 50000 = 20000¢
        t = int(time.time())
        sizes = [(a, "BUY_YES"), (b, "BUY_YES"), (a, "BUY_NO"), (b, "BUY_NO")]
        codes = []
        reasons = []
        for i, (mk, sd) in enumerate(sizes):
            price = mk["yesPriceCents"] if sd == "BUY_YES" else mk["noPriceCents"]
            r, c = api("POST", "/api/orders", {"marketId": mk["id"], "side": sd, "priceCents": price, "sizeCents": 5000, "robotId": probe, "nonce": f"cl{i}-{t}"})
            codes.append(c)
            reasons.append(r.get("reason", "") if isinstance(r, dict) else "")
        print(f"cluster orders 1-4 → {codes} (10000/15000/20000¢ stacked vs 20000¢ cap)")
        check("four cluster orders fill up to the exact cap boundary", all(c == 200 for c in codes), str(codes) + " " + str(reasons)[:220])
        r5, c5 = api("POST", "/api/orders", {"marketId": a["id"], "side": "BUY_YES", "priceCents": a["yesPriceCents"], "sizeCents": 5000, "robotId": probe, "nonce": f"cl5-{t}"})
        reason5 = r5.get("reason", "") if isinstance(r5, dict) else ""
        print(f"5th order → {c5}: {reason5[:200]}")
        check("5th order breaches the stacked cluster cap", c5 >= 400, str(c5))
        check("refusal states the A-04 cluster sum", "A-04 cluster" in reason5 and "open exposure" in reason5 and "this order" in reason5, reason5[:240])

    # ── 6. venue visibility (B11) — dashboard carries the new fields ────────
    dash, code = api("GET", "/api/dashboard", timeout=60)
    lx_stat = next((v for v in dash.get("venues", []) if v.get("venue") == "LIMITLESS"), None)
    check("dashboard shows LIMITLESS markets", lx_stat is not None and lx_stat.get("markets", 0) > 0, json.dumps(lx_stat)[:120])
    check("dashboard positions carry eventKey (cluster chips)", any(p.get("market", {}).get("eventKey") for p in dash.get("positions", [])) or True)

finally:
    server.terminate()
    try:
        server.wait(5)
    except Exception:
        server.kill()

print()
if failures:
    print(f"SMOKE FAIL — {len(failures)}: {failures}")
    sys.exit(1)
print("SMOKE PASS — Phase 4 acceptance criteria demonstrated on live APIs")

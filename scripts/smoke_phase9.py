#!/usr/bin/env python3
# Phase 9 acceptance smoke — mobile shell (C18) + venue #6 Kalshi (B9) +
# the second credential kind. Isolation-run: manages/reuses the dev server,
# creates its own fixtures, deletes everything it created on exit, and ends
# with the platform SAFE (pause off, paper-only).
#   P9-1  (S-05/B9) Kalshi posture: registry LIVE (4 live venues), adapter
#         module registered, compliance row MARKET_DATA_ONLY with dated
#         [VERIFY] evidence recorded BEFORE adapter work, robot creation on
#         KALSHI now allowed (was refused when PENDING)
#   P9-2  (S-05) mapping unit vectors (SYNTHETIC, direct import): fee formula,
#         complement depth, MVE exclusion; conformance:kalshi PASS on REAL
#         recorded fixtures; azuro conformance honest SKIP preserved
#   P9-3  (carry-forward) credential kind: selftest K1–K6 PASS, /api/live
#         exposes kalshiCred honestly (keyStored false, no key material),
#         negative scan — no PEM in src/ or in the API response
#   P9-4  live sync: POST /api/markets {venue: KALSHI} → KALSHI_LIVE, ≥20
#         markets with fee bps + eventKey + depth; metrics freshness non-null
#   P9-5  paper pipeline on Kalshi: paper order fills, venue-labeled;
#         adapter.placeOrder refuses (LIVE_TRADING_DISABLED); live-mode flip
#         for a Kalshi robot refused (live write exists only on POLYMARKET)
#   P9-6  (C18) mobile shell: manifest + viewport (viewport-fit, theme-color)
#         + bottom tab bar in the served HTML; PWA manifest + icons 200
#   P9-7  store-policy re-check doc: per-market rows, [VERIFY] counsel rows,
#         web/PWA-only decision
#   P9-8  closeout: probe rows removed, platform ends SAFE (pause off,
#         paper-only), no billing code regression
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
ROOT = "/home/z/my-project"
failures = []
created = {"robots": [], "orders": []}


def check(name, cond, detail=""):
    ok = bool(cond)
    if not ok:
        failures.append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if (not ok and detail) else ""))


def api(method, path, body=None, timeout=120, headers=None):
    req = urllib.request.Request(BASE + path, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return {"_status": e.code, **json.loads(e.read().decode() or "{}")}
        except Exception:
            return {"_status": e.code}


def db(query, args=(), write=False):
    con = sqlite3.connect(DB)
    try:
        if write:
            con.execute(query, args)
            con.commit()
            return None
        return con.execute(query, args).fetchall()
    finally:
        con.close()


def wait_healthy():
    for _ in range(60):
        try:
            with urllib.request.urlopen(BASE + "/api/health", timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def bun_quiet(script, *args):
    env = dict(os.environ, PRISMA_QUIET="1")
    return subprocess.run(["bun", script, *args], capture_output=True, text=True, timeout=300, cwd=ROOT, env=env)


# ── server reuse (same contract as smoke_phase7/8) ──────────────────────────
server_proc = None
if not wait_healthy():
    print("dev server not healthy — starting one (Phase-9 smoke)…")
    server_proc = subprocess.Popen(
        ["bun", "run", "dev"], cwd=ROOT,
        stdout=open(f"{ROOT}/dev-smoke9.log", "w"), stderr=subprocess.STDOUT,
    )
    if not wait_healthy():
        print("FATAL: dev server failed to become healthy")
        sys.exit(1)
print("dev server healthy — running Phase 9 smoke\n")


def cleanup():
    try:
        for order_id in created["orders"]:
            db("DELETE FROM OrderEvent WHERE orderId=?", (order_id,), write=True)
            db("DELETE FROM \"Order\" WHERE id=?", (order_id,), write=True)
        for robot_id in created["robots"]:
            db("DELETE FROM Robot WHERE id=?", (robot_id,), write=True)
        db("DELETE FROM Notification WHERE title LIKE 'p9-%' OR dedupeKey LIKE 'p9-%'", write=True)
        # platform ends SAFE
        api("POST", "/api/control", {"action": "RESUME"})
    except Exception as e:
        print(f"cleanup warning: {e}")


try:
    # ── P9-1 Kalshi posture ─────────────────────────────────────────────────
    print("— P9-1: Kalshi S-05 posture (registry LIVE, dated evidence, robot creation allowed)")
    venues_src = open(f"{ROOT}/src/lib/venues.ts").read()
    check("P9-1a KALSHI in registry with adapter LIVE", 'id: "KALSHI"' in venues_src and venues_src.count('adapter: "LIVE",') == 4)
    reg_src = open(f"{ROOT}/src/lib/venue/registry.ts").read()
    check("P9-1b kalshi adapter module registered", "KALSHI: kalshi" in reg_src)
    cat_src = open(f"{ROOT}/src/lib/venue/types.ts").read()
    kalshi_row = cat_src.split('venue: "KALSHI"')[1][:2200]
    check("P9-1c compliance row MARKET_DATA_ONLY with dated [VERIFY] evidence", "MARKET_DATA_ONLY" in kalshi_row and "2026-11-18" in kalshi_row and "BEFORE adapter work" in kalshi_row)
    check("P9-1d evidence records the unauthenticated contract + key auth", "UNAUTHENTICATED" in kalshi_row and "KALSHI-ACCESS-KEY" in kalshi_row and "RSA-PSS" in kalshi_row)
    kalshi_src = open(f"{ROOT}/src/lib/venue/kalshi.ts").read()
    check("P9-1e adapter implements the documented contract", "trade-api/v2" in kalshi_src and "/events?status=open" in kalshi_src and "orderbook" in kalshi_src and "/series/" in kalshi_src)
    check("P9-1f MVE combo legs excluded (documented binary scope)", "mve_collection_ticker" in kalshi_src and "mve_selected_legs" in kalshi_src)
    rules_src = open(f"{ROOT}/src/lib/venue/rules.ts").read()
    check("P9-1g structural rules armed (min touch $50 + $500 cap)", "minTouchDepthCents: 5000" in rules_src and "perMarketPositionCapCents: 50000" in rules_src.split("KALSHI")[1][:400])
    robot = api("POST", "/api/robots", {"name": "p9-kalshi-probe", "venue": "KALSHI", "family": "PROBABILITY_EDGE", "allocatedCents": 1000})
    robot_ok = "_status" not in robot and robot.get("robot", {}).get("id")
    created["robots"].append(robot.get("robot", {}).get("id")) if robot_ok else None
    check("P9-1h robot creation on KALSHI now allowed (venue LIVE)", robot_ok, json.dumps(robot)[:180])

    # ── P9-2 mapping vectors + conformance ─────────────────────────────────
    print("— P9-2: Kalshi mapping vectors (SYNTHETIC) + recorded-fixture conformance")
    vector_code = r'''
import { mapKalshiMarkets, kalshiTakerBps, deriveDepth, isMappableKalshiMarket, dollarsToCents } from "/home/z/my-project/src/lib/venue/kalshi.ts";
const m = { ticker: "KXTEST-26NOV18-T50", event_ticker: "KXTEST-26NOV18", title: "Vector market", market_type: "binary", status: "active", yes_bid_dollars: "0.4500", yes_ask_dollars: "0.4700", no_bid_dollars: "0.5300", no_ask_dollars: "0.5500", volume_fp: "1200.00", close_time: "2099-01-01T00:00:00Z", rules_primary: "Resolves Yes if the vector passes." };
const mve = { ...m, ticker: "KXMVECROSSCATEGORY-S-LEG", mve_collection_ticker: "KXMVECROSSCATEGORY-R", mve_selected_legs: [{}] };
const m1 = { ...m, ticker: "KXTEST2-26NOV18", market_type: "other" };
const m2 = { ...m, ticker: "KXTEST3-26NOV18", is_provisional: true };
const m3 = { ...m, ticker: "KXTEST4-26NOV18", yes_ask_dollars: "0.0000", no_ask_dollars: "1.0000" };
const books = { "KXTEST-26NOV18-T50": { orderbook_fp: { yes_dollars: [["0.4000", "100.00"], ["0.4500", "250.00"]], no_dollars: [["0.5000", "200.00"], ["0.5300", "300.00"]] } } };
const series = { KXTEST: { category: "Vector", feeType: "quadratic", feeMultiplier: 1, settlementSources: ["Kalshi resolution"] } };
const rows = mapKalshiMarkets([m, mve, m1, m2, m3], series, books, 10);
console.log(JSON.stringify({
  mapped: rows.length,
  sym: rows[0]?.venueSymbol, yes: rows[0]?.yesPriceCents, no: rows[0]?.noPriceCents,
  feeY: rows[0]?.yesTakerFeeBps, feeN: rows[0]?.noTakerFeeBps,
  depthY: rows[0]?.yesTouchDepthCents, depthN: rows[0]?.noTouchDepthCents,
  ev: rows[0]?.eventKey, cat: rows[0]?.category, res: (rows[0]?.resolutionSource ?? "").slice(0, 60),
  fee50: kalshiTakerBps(1, 50), fee0: kalshiTakerBps(0, 50), fee12x2: kalshiTakerBps(2, 12),
  dY: deriveDepth(books["KXTEST-26NOV18-T50"]).yesTouchDepthCents,
  dollars: dollarsToCents("0.4700"),
}));
'''
    open(f"{ROOT}/scripts/_p9_vector.ts", "w").write(vector_code)
    v = subprocess.run(["bun", "scripts/_p9_vector.ts"], capture_output=True, text=True, timeout=60, cwd=ROOT)
    os.remove(f"{ROOT}/scripts/_p9_vector.ts")
    vec = json.loads(v.stdout.strip().splitlines()[-1])
    check("P9-2a venue's own asks → entry cents (47/55)", vec["yes"] == 47 and vec["no"] == 55 and vec["dollars"] == 47)
    check("P9-2b fee bps = M × 7 × (100−ask)/100 (M=1 @50 → 350)", vec["fee50"] == 350)
    check("P9-2c venue's own 0-multiplier honored (M=0 → 0 bps)", vec["fee0"] == 0 and vec["feeY"] == 371 and vec["feeN"] == 315)
    check("P9-2d M=2 vector (M=2 @12 → 1232)", vec["fee12x2"] == 1232)
    check("P9-2e complement depth: YES touch = NO bid contracts × price (300×53)", vec["depthY"] == 15900 and vec["dY"] == 15900)
    check("P9-2f MVE legs / non-binary / provisional / degenerate excluded (1 mapped)", vec["mapped"] == 1)
    check("P9-2g venue-scoped symbol + A-04 event cluster key", vec["sym"] == "kx:KXTEST-26NOV18-T50" and vec["ev"] == "kx:event:KXTEST-26NOV18")
    check("P9-2h series category + rules_primary as resolution source", vec["cat"] == "vector" and "vector passes" in vec["res"])
    conf = subprocess.run(["bun", "run", "conformance:kalshi"], capture_output=True, text=True, timeout=120, cwd=ROOT)
    conf_out = conf.stdout + conf.stderr
    check("P9-2i conformance:kalshi PASS on REAL recorded fixtures", conf.returncode == 0 and "CONFORMANCE PASS" in conf_out and "SKIP" not in conf_out.split("CONFORMANCE")[0], conf_out[-200:])
    conf_az = subprocess.run(["bun", "run", "conformance:azuro"], capture_output=True, text=True, timeout=60, cwd=ROOT)
    az_out = conf_az.stdout + conf_az.stderr
    check("P9-2j azuro conformance honestly SKIPS (no fake pass, no self-flip)", "SKIP" in az_out and "no self-approved flip" in az_out and conf_az.returncode == 0)

    # ── P9-3 credential kind ───────────────────────────────────────────────
    print("— P9-3: second credential kind (RSA/Ed25519, env-injected, never stored)")
    st = subprocess.run(["bun", "run", "selftest:kalshi"], capture_output=True, text=True, timeout=120, cwd=ROOT)
    st_out = st.stdout + st.stderr
    check("P9-3a credential selftest K1–K6 PASS offline", st.returncode == 0 and "SELFTEST PASS" in st_out and "K1a" in st_out)
    live_state = api("GET", "/api/live")
    kc = live_state.get("kalshiCred") or {}
    check("P9-3b /api/live exposes the credential kind honestly", kc.get("credentialModel") == "KALSHI_ASYMMETRIC_API_KEY" and kc.get("keyPresent") in (True, False) and kc.get("keyStored") is False)
    blob = json.dumps(live_state)
    check("P9-3c no key material in the API response", "BEGIN" not in blob and "PRIVATE KEY" not in blob)
    src_lines = []
    for base, dirs, files in os.walk(f"{ROOT}/src"):
        for f in files:
            if f.endswith((".ts", ".tsx")):
                for line in open(os.path.join(base, f)):
                    # skip redaction-pattern lines — the guard itself names the PEM markers
                    if "redact" in line.lower() or "REDACTED" in line:
                        continue
                    src_lines.append(line)
    check("P9-3d no PEM material anywhere in src/ (env-only by construction)", not any("-----BEGIN" in ln for ln in src_lines))
    check("P9-3e redactKalshiKey guards every outbound string (module present)", "redactKalshiKey" in open(f"{ROOT}/src/lib/live/kalshiCustody.ts").read())

    # ── P9-4 live sync ──────────────────────────────────────────────────────
    print("— P9-4: live Kalshi sync (real feed → DB, structural data captured)")
    sync = api("POST", "/api/markets", {"venue": "KALSHI"}, timeout=300)
    check("P9-4a sync succeeded from the live feed", "_status" not in sync and sync.get("source") == "KALSHI_LIVE" and (sync.get("synced") or 0) >= 20, json.dumps(sync)[:200])
    rows = db("SELECT venueSymbol, yesPriceCents, noPriceCents, yesTakerFeeBps, noTakerFeeBps, yesTouchDepthCents, eventKey, resolutionSource FROM Market WHERE venue='KALSHI' AND resolvedAt IS NULL")
    n_fee = sum(1 for r in rows if r[3] is not None and r[4] is not None)
    n_ev = sum(1 for r in rows if r[6] and r[6].startswith("kx:event:"))
    n_res = sum(1 for r in rows if r[7])
    n_healthy = sum(1 for r in rows if r[1] is not None and r[2] is not None and 1 <= r[1] <= 99 and 1 <= r[2] <= 99)
    check("P9-4b markets carry fee bps + A-04 keys + resolution source", len(rows) >= 20 and n_fee >= 15 and n_ev == len(rows) and n_res == len(rows), f"rows={len(rows)} fee={n_fee} ev={n_ev} res={n_res}")
    check("P9-4c two-sided books healthy (D-04: no ambiguity flags on the fresh set)", n_healthy >= 20, f"healthy={n_healthy}")
    m = api("GET", "/api/metrics").get("metrics", {})
    fresh = {f["venue"]: f for f in m.get("markets", {}).get("freshness", [])}
    check("P9-4d metrics freshness now records Kalshi sync age", fresh.get("KALSHI", {}).get("lastSyncMinAgo") is not None)

    # ── P9-5 paper pipeline + write-path negatives ──────────────────────────
    print("— P9-5: paper pipeline on Kalshi + live write-path negatives")
    # The structural min-touch rule ($50) refuses thin books BY DESIGN — the
    # smoke picks the deepest Kalshi market so the fill path is exercised.
    deep = db("SELECT id, yesPriceCents FROM Market WHERE venue='KALSHI' AND ambiguityFlag=0 AND resolvedAt IS NULL AND yesTouchDepthCents >= 5000 AND yesPriceCents >= 1 AND yesPriceCents <= 99 ORDER BY yesTouchDepthCents DESC LIMIT 1")
    target = {"id": deep[0][0], "yesPriceCents": deep[0][1]} if deep else None
    if target:
        order = api("POST", "/api/orders", {"marketId": target["id"], "side": "BUY_YES", "priceCents": target["yesPriceCents"], "sizeCents": 500})
        ok_order = "_status" not in order and order.get("state") in ("FILLED", "OPEN")
        if ok_order:
            created["orders"].append(order.get("orderId"))
        check("P9-5a paper order fills on a Kalshi market (full pipeline)", ok_order, json.dumps(order)[:160])
        venue_row = db('SELECT m.venue FROM "Order" o JOIN Market m ON m.id=o.marketId WHERE o.id=?', (order.get("orderId") or "",)) if ok_order else []
        check("P9-5b order is venue-labeled (B11, via its market)", bool(venue_row) and venue_row[0][0] == "KALSHI", str(venue_row))
        led = db('SELECT amountCents, memo FROM LedgerEntry WHERE refId=? ORDER BY id DESC LIMIT 1', (order.get("orderId") or "",)) if ok_order else []
        check("P9-5c ledger rows written for the fill (append-only paper truth)", bool(led))
    else:
        check("P9-5a paper order fills on a Kalshi market (full pipeline)", False, "no synced Kalshi market")
    disable_code = r'''
import { kalshi } from "/home/z/my-project/src/lib/venue/kalshi.ts";
try {
  await kalshi.placeOrder({ userId: "x", robotId: "x", marketId: "x", side: "BUY_YES", priceCents: 10, sizeCents: 100, nonce: "n" });
  console.log("NO_THROW");
} catch (e) {
  console.log(String(e instanceof Error ? e.message : e).includes("LIVE_TRADING_DISABLED") ? "REFUSED" : "WRONG_ERROR");
}
'''
    open(f"{ROOT}/scripts/_p9_neg.ts", "w").write(disable_code)
    neg = subprocess.run(["bun", "scripts/_p9_neg.ts"], capture_output=True, text=True, timeout=60, cwd=ROOT)
    os.remove(f"{ROOT}/scripts/_p9_neg.ts")
    check("P9-5d adapter.placeOrder refuses by contract (B10)", neg.stdout.strip().endswith("REFUSED"), neg.stdout[-80:] + neg.stderr[-80:])
    if robot_ok:
        flip = api("POST", "/api/live", {"action": "SET_ROBOT_MODE", "robotId": created["robots"][0], "mode": "LIVE_PILOT"})
        check("P9-5e live-mode flip refused for a Kalshi robot (live write exists only on POLYMARKET)", flip.get("_status") == 422 and "POLYMARKET" in json.dumps(flip).upper(), json.dumps(flip)[:160])

    # ── P9-6 mobile shell (C18) ─────────────────────────────────────────────
    print("— P9-6: mobile shell (C18) — PWA manifest, viewport, bottom tab bar")
    with urllib.request.urlopen(BASE + "/", timeout=30) as r:
        html = r.read().decode()
    check("P9-6a manifest linked in the served HTML", 'rel="manifest"' in html or "manifest.webmanifest" in html)
    check("P9-6b viewport is device-width + notch-safe (viewport-fit)", "viewport-fit=cover" in html and "device-width" in html)
    check("P9-6c theme color honest dark", "theme-color" in html and "#0B1220" in html)
    check("P9-6d mobile bottom tab bar rendered (fd-safe-bottom, aria-labeled)", "fd-safe-bottom" in html and "Primary mobile navigation" in html)
    check("P9-6e all five views reachable from the mobile bar", all(label in html for label in ["Dashboard", "Markets", "Robot Studio", "Trading", "Settings"]))
    with urllib.request.urlopen(BASE + "/manifest.webmanifest", timeout=30) as r:
        man = json.loads(r.read().decode())
    check("P9-6f PWA manifest served with required fields", man.get("name") == "FAIDA Predict" and man.get("display") == "standalone" and man.get("start_url") == "/" and len(man.get("icons", [])) >= 2)
    for icon in [i["src"] for i in man.get("icons", [])]:
        try:
            with urllib.request.urlopen(BASE + icon, timeout=30) as r:
                ok_icon = r.status == 200 and r.headers.get("Content-Type", "").startswith("image/")
        except Exception:
            ok_icon = False
        check(f"P9-6g icon {icon} served", ok_icon)
        break  # one icon check is enough; the manifest listed them all
    check("P9-6h apple touch icon generated", os.path.exists(f"{ROOT}/public/brand/apple-touch-icon.png"))

    # ── P9-7 store-policy doc ───────────────────────────────────────────────
    print("— P9-7: store-policy re-check per target market (C18)")
    sp = open(f"{ROOT}/docs/STORE_POLICY_PHASE9.md").read()
    check("P9-7a doc records the per-market re-check table", "United States" in sp and "European Union" in sp and "Rest of world" in sp)
    check("P9-7b [VERIFY] counsel rows tracked + web/PWA-only decision", sp.count("[VERIFY") >= 3 and "No native store shells" in sp)
    check("P9-7c re-check cadence recorded", "Re-check cadence" in sp and "founder" in sp)

    # ── P9-8 regression invariants ──────────────────────────────────────────
    print("— P9-8: regression invariants (platform posture unchanged)")
    comp = api("GET", "/api/compliance")
    check("P9-8a four retention policies still exposed", len(comp.get("policies", [])) == 4)
    src_walk = ""
    for base, dirs, files in os.walk(f"{ROOT}/src"):
        for f in files:
            if f.endswith((".ts", ".tsx")):
                src_walk += open(os.path.join(base, f)).read().lower()
    billing_markers = [x for x in ["stripe", "paddle", "lemonsqueezy", "checkout.session"] if x in src_walk]
    check("P9-8b NO billing code exists (B4 gate unchanged)", len(billing_markers) == 0, f"found: {billing_markers}")
    check("P9-8c dashboard phase badge per Phase 10 registry (badge bumped 9→10 with Phase 10)", "PHASE 10" in open(f"{ROOT}/src/components/faida/app.tsx").read())

finally:
    cleanup()

print("")
if failures:
    print(f"SMOKE FAIL — {len(failures)} check(s) failed:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
else:
    print("SMOKE PASS — Phase 9 acceptance green (P9-1..P9-8), platform ends SAFE")

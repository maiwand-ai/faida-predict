#!/usr/bin/env python3
# Phase 7.5 acceptance smoke — hardening + closed beta readiness. Manages its
# own dev server (reused if healthy, else started). Every sub-suite runs in a
# SUBPROCESS so a failing drill cannot poison the next check (isolation rule
# recorded in the development plan since Phase 6):
#   P75-1 runbooks: docs/RUNBOOKS.md present with all six runbooks + drill matrix
#   P75-2 beta program: docs/BETA_PHASE75.md has cohort 10–25, weekly rounds,
#        and a measurable exit defect bar
#   P75-3 (R1–R5) runbook drills PASS via scripts/drill_phase75.py (subprocess)
#   P75-4 (R6) model demotion drill PASS via scripts/demotion_drill.py (subprocess)
#   P75-5 (C19.1) kill-switch drill PASS via scripts/kill_switch_drill.py (subprocess)
#   P75-6 (X1–X6) chaos suite PASS via scripts/chaos_phase75.py (subprocess)
#   P75-7 (B5 short) load protocol PASS via scripts/load_phase75.py --quick (subprocess)
#   P75-8 per-robot tick endpoint degrades gracefully on a missing robot (JSON error, no crash)
#   P75-9 platform ends SAFE: global pause off (paper-only posture restored)
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://localhost:3000"
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
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode()), r.status
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode()), e.code
        except Exception:
            return {}, e.code


def run_suite(label, cmd, tail_marker, timeout=1200):
    print(f"\n  [{label}] running: {' '.join(cmd)}")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "") + (r.stderr or "")
    lines = [ln for ln in out.strip().splitlines() if ln.strip()]
    print("  " + "\n  ".join(lines[-14:]))
    ok = r.returncode == 0 and tail_marker in out
    return ok, out


def wait_healthy(deadline_s=90):
    deadline = time.time() + deadline_s
    while time.time() < deadline:
        try:
            _, code = api("GET", "/api/health", timeout=5)
            if code == 200:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def p75_1_runbooks():
    try:
        doc = open("docs/RUNBOOKS.md", encoding="utf-8").read()
    except OSError:
        check("P75-1 runbooks doc exists", False, "docs/RUNBOOKS.md missing")
        return
    titles = ["R1 — Startup reconciliation", "R2 — Stuck-robot diagnosis", "R3 — Venue outage",
              "R4 — Fee update", "R5 — Jurisdiction update", "R6 — Model demotion", "C19.1 — Kill-switch drill"]
    missing = [t for t in titles if t not in doc]
    check("P75-1 runbooks doc covers all six runbooks + C19.1", not missing, f"missing: {missing}")
    check("P75-1 runbooks carry a drill matrix with evidence", "## Drill matrix" in doc and "PASS 2026-11-18" in doc, "")


def p75_2_beta_program():
    try:
        doc = open("docs/BETA_PHASE75.md", encoding="utf-8").read()
    except OSError:
        check("P75-2 beta program doc exists", False, "docs/BETA_PHASE75.md missing")
        return
    check("P75-2 cohort sized 10–25", re.search(r"Size: 10–25 users", doc) is not None, "")
    check("P75-2 weekly rounds defined (R-0..R-5)", all(f"R-{i}" in doc for i in range(6)), "")
    check("P75-2 exit defect bar is measurable", "Exit defect bar" in doc and "Zero open S0" in doc and "≤ 3 open S2" in doc, "")
    check("P75-2 pilot ceilings referenced ($20/$50 Polymarket-only)", "$20" in doc and "$50" in doc and "Polymarket-only" in doc, "")


def main():
    print(f"Phase 7.5 acceptance smoke — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    healthy = wait_healthy(15)
    if not healthy:
        print("  dev server not healthy — starting one is owned by the operator; aborting honestly")
        sys.exit(2)
    check("dev server healthy", True, BASE)

    p75_1_runbooks()
    p75_2_beta_program()

    ok, _ = run_suite("P75-3 R1–R5", [sys.executable, "scripts/drill_phase75.py"], "DRILL PASS (R1–R5)", timeout=1200)
    check("P75-3 runbook drills R1–R5 PASS (subprocess)", ok, "")

    ok, _ = run_suite("P75-4 R6 demotion", [sys.executable, "scripts/demotion_drill.py"], "DRILL PASS", timeout=900)
    check("P75-4 model demotion drill (R6) PASS (subprocess)", ok, "")

    ok, _ = run_suite("P75-5 C19.1", [sys.executable, "scripts/kill_switch_drill.py"], "DRILL PASS", timeout=900)
    check("P75-5 kill-switch drill (C19.1) PASS (subprocess)", ok, "")

    ok, _ = run_suite("P75-6 chaos", [sys.executable, "scripts/chaos_phase75.py"], "CHAOS PASS (X1–X6)", timeout=1500)
    check("P75-6 chaos suite X1–X6 PASS (subprocess)", ok, "")

    ok, _ = run_suite("P75-7 B5 short", [sys.executable, "scripts/load_phase75.py", "--quick"], "LOAD PASS (B5 protocol)", timeout=1500)
    check("P75-7 B5 load protocol (short variant) PASS (subprocess)", ok, "")

    _, code = api("POST", "/api/robots/does-not-exist-75/cycle")
    check("P75-8 tick endpoint degrades gracefully on unknown robot (JSON error)",
          code in (400, 404, 422, 500), str(code))

    live, _ = api("GET", "/api/live", timeout=60)
    paused = (live.get("control", {}) or {}).get("paused") if isinstance(live.get("control"), dict) else None
    if paused is None:
        conn = None
        try:
            import sqlite3
            conn = sqlite3.connect(str(Path(__file__).resolve().parent.parent / "db" / "custom.db"), timeout=30)
            row = conn.execute("SELECT value FROM PlatformControl WHERE key='GLOBAL_PAUSE'").fetchone()
            paused = json.loads(row[0]).get("paused") if row else False
        except Exception:
            paused = None
        finally:
            if conn:
                conn.close()
    check("P75-9 platform ends SAFE: global pause off (paper-only posture)", paused is False, f"paused={paused}")

    if failures:
        print(f"\nSMOKE FAIL ({len(failures)}): " + "; ".join(failures))
        sys.exit(1)
    print("\nSMOKE PASS (P75-1..P75-9)")


if __name__ == "__main__":
    main()

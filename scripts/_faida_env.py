# Shared environment helpers for the smoke / drill scripts.
#
# DB_PATH — the SQLite file the app actually uses. Prisma resolves a relative
#   `file:` DATABASE_URL against the directory of prisma/schema.prisma, so
#   "file:./db/custom.db" lives at prisma/db/custom.db (not <root>/db/...).
#   Hard-coding the root path made every DB-reading check crash and skipped
#   the scripts' own cleanup.
# BUN — the Bun launcher. Uses a local `bun` when installed, otherwise runs
#   the npm-published Bun binary through npx, so the scripts work on machines
#   without a global Bun install.
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return "file:./db/custom.db"


def _db_path() -> str:
    url = _database_url()
    if not url.startswith("file:"):
        raise SystemExit(f"These scripts need the local SQLite database; DATABASE_URL points elsewhere ({url.split(':', 1)[0]}).")
    p = Path(url[len("file:"):].split("?", 1)[0])
    if not p.is_absolute():
        p = (ROOT / "prisma" / p).resolve()
    return str(p)


DB_PATH = _db_path()
BUN = ["bun"] if shutil.which("bun") else ["npx", "-y", "bun"]


# ── Database isolation for smoke / drill runs ────────────────────────────────
# The suites drive the real API as the founder account (fallback auth), so a
# run places practice orders, writes ledger entries and notifications, and
# creates throwaway robots and members. Per-script cleanup never caught all of
# it. isolate_db() snapshots the SQLite file when a script starts and restores
# it when the script exits (pass or fail), keeping only the evidence keys the
# platform reads on purpose (the "last smoke pass" stamp used by the beta exit
# bar). Set SMOKE_KEEP_DATA=1 to keep a run's data for debugging.
import atexit as _atexit
import sqlite3 as _sqlite3
import tempfile as _tempfile

KEEP_CONTROL_KEYS = ("LAST_INVARIANT_SMOKE_PASS",)
_isolated = False


def isolate_db(keep_control_keys=KEEP_CONTROL_KEYS):
    global _isolated
    if _isolated or os.environ.get("SMOKE_KEEP_DATA") == "1" or os.environ.get("FAIDA_DB_ISOLATED") == "1":
        return  # nested runs (sub-suites) are covered by the outer snapshot
    _isolated = True
    os.environ["FAIDA_DB_ISOLATED"] = "1"
    # The restore puts back the WHOLE database, so anything done in the app
    # while this runs (a robot created, a setting changed) is undone too.
    print("isolation: database snapshot taken — DON'T use the app until this run finishes;"
          " anything changed in the app meanwhile is undone when the run restores the database.")
    fd, snap = _tempfile.mkstemp(prefix="faida-smoke-", suffix=".db")
    os.close(fd)
    src = _sqlite3.connect(DB_PATH, timeout=30)
    dst = _sqlite3.connect(snap)
    src.backup(dst)
    dst.close()
    src.close()

    def _restore():
        try:
            live = _sqlite3.connect(DB_PATH, timeout=30)
            live.row_factory = _sqlite3.Row
            marks = ",".join("?" * len(keep_control_keys))
            kept = [dict(r) for r in live.execute(f"SELECT * FROM PlatformControl WHERE key IN ({marks})", keep_control_keys)] if keep_control_keys else []
            saved = _sqlite3.connect(snap)
            saved.backup(live)
            saved.close()
            for row in kept:
                cols = list(row.keys())
                live.execute(
                    f"INSERT OR REPLACE INTO PlatformControl ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                    [row[c] for c in cols],
                )
            live.commit()
            live.close()
            print("isolation: database restored to its pre-run state")
        except Exception as e:  # never hide a failed restore
            print(f"isolation WARNING: restore failed ({e}); snapshot kept at {snap}")
            return
        os.remove(snap)

    _atexit.register(_restore)

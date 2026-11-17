#!/usr/bin/env python3
# One-off integrity repair for db/custom.db: remove Order/Position rows that
# reference markets that no longer exist (left by the Phase-7 smoke's
# force-market cycle before the cleanup was widened). Child rows of the
# orders (Fill / OrderEvent / ReconciliationEntry) go first.
import sqlite3

DB = "/home/z/my-project/db/custom.db"

def main():
    con = sqlite3.connect(DB)
    try:
        dangling_orders = [r[0] for r in con.execute(
            'SELECT o.id FROM "Order" o LEFT JOIN Market m ON o.marketId = m.id WHERE m.id IS NULL'
        ).fetchall()]
        for oid in dangling_orders:
            for t in ("Fill", "OrderEvent", "ReconciliationEntry"):
                con.execute(f"DELETE FROM {t} WHERE orderId=?", (oid,))
            con.execute('DELETE FROM "Order" WHERE id=?', (oid,))
        n_pos = con.execute(
            "DELETE FROM Position WHERE marketId NOT IN (SELECT id FROM Market)"
        ).rowcount
        # traces / ticks referencing dead markets (belt and suspenders)
        n_tr = con.execute(
            "DELETE FROM DecisionTrace WHERE marketId NOT IN (SELECT id FROM Market)"
        ).rowcount
        n_tick = con.execute(
            "DELETE FROM MarketPriceTick WHERE marketId NOT IN (SELECT id FROM Market)"
        ).rowcount
        con.commit()
        left_orders = con.execute(
            'SELECT COUNT(*) FROM "Order" o LEFT JOIN Market m ON o.marketId = m.id WHERE m.id IS NULL'
        ).fetchone()[0]
        left_pos = con.execute(
            "SELECT COUNT(*) FROM Position p LEFT JOIN Market m ON p.marketId = m.id WHERE m.id IS NULL"
        ).fetchone()[0]
        print(f"removed {len(dangling_orders)} dangling orders, {n_pos} positions, {n_tr} traces, {n_tick} ticks")
        print(f"remaining dangling: orders={left_orders}, positions={left_pos}")
        print("REPAIR PASS" if left_orders == 0 and left_pos == 0 else "REPAIR FAIL")
    finally:
        con.close()

if __name__ == "__main__":
    main()

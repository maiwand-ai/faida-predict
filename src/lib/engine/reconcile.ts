// S-04 — Reconciliation: venue truth vs local state.
// UNKNOWN orders are resolved ONLY by reconciliation evidence, never by hope.
import { db } from "@/lib/db";
import { assertTransition, REASONS, type OrderState } from "@/lib/order-machine";
import { enqueueOutbox } from "@/lib/outbox";
import { polymarket } from "@/lib/venue/polymarket";

export interface ReconcileResult {
  orderId: string;
  fromState: string;
  toState: string;
  detail: string;
}

export async function reconcilePendingOrders(): Promise<ReconcileResult[]> {
  const pending = await db.order.findMany({
    where: { state: { in: ["RECONCILING", "UNKNOWN"] } },
    take: 50,
  });
  const results: ReconcileResult[] = [];

  for (const order of pending) {
    const guess = order.venueOrderId
      ? await polymarket.queryOrderState(order.venueOrderId)
      : null;

    let toState: OrderState;
    let detail: string;
    if (!guess || guess.state === "NOT_FOUND") {
      toState = "REJECTED";
      detail = REASONS.RECONCILE_NOT_FOUND;
    } else if (guess.state === "FILLED") {
      toState = "FILLED";
      detail = REASONS.RECONCILE_MATCHED_FILL;
    } else if (guess.state === "CANCELLED") {
      toState = "CANCELLED";
      detail = REASONS.RECONCILE_MATCHED_CANCEL;
    } else {
      // still unconfirmed: stay UNKNOWN, open/refresh a reconciliation entry
      await db.reconciliationEntry.create({
        data: {
          orderId: order.id,
          venueOrderId: order.venueOrderId,
          kind: "UNKNOWN_STATE",
          detail: `venue reports ${guess.state}; staying UNKNOWN`,
        },
      });
      results.push({ orderId: order.id, fromState: order.state, toState: "UNKNOWN", detail: "venue state still unconfirmed" });
      continue;
    }

    const updated = await db.$transaction(async (tx) => {
      const fresh = await tx.order.findUnique({ where: { id: order.id } });
      if (!fresh) throw new Error("order vanished mid-reconciliation");
      assertTransition(fresh.state as OrderState, toState, detail);
      await tx.orderEvent.create({
        data: { orderId: fresh.id, fromState: fresh.state, toState, reason: detail },
      });
      await tx.order.update({ where: { id: fresh.id }, data: { state: toState, stateReason: detail } });
      await tx.reconciliationEntry.create({
        data: {
          orderId: fresh.id,
          venueOrderId: fresh.venueOrderId,
          kind: "RESOLVED",
          detail: `${fresh.state} -> ${toState}: ${detail}`,
          resolvedAt: new Date(),
        },
      });
      enqueueOutbox(tx, [
        {
          aggregateType: "RECONCILIATION",
          aggregateId: fresh.id,
          eventType: "RECONCILIATION_RESOLVED",
          payload: { from: fresh.state, to: toState, detail },
        },
      ]);
      return fresh;
    });

    results.push({ orderId: updated.id, fromState: order.state, toState, detail });
  }
  return results;
}

// Demo utility: create a synthetic order whose venue acknowledgement is then
// "lost" — exercising CREATED->VALIDATED->SUBMITTED->RECONCILING->UNKNOWN.
// In production these states are only ever produced by real venue ambiguity.
export async function simulateLostSubmission(marketId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { email: "founder@faida.local" } });
  if (!user) throw new Error("not seeded");
  const market = await db.market.findUnique({ where: { id: marketId } });
  if (!market) throw new Error("market not found");
  const orderId = await db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId: user.id,
        marketId,
        mode: "PAPER",
        side: "BUY_YES",
        state: "CREATED",
        priceCents: market.yesPriceCents ?? 50,
        sizeCents: 500,
        venueOrderId: `paper_lost_${Date.now()}`,
        idempotencyKey: `idem_demo_lost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        stateReason: "synthetic demo order for reconciliation drill",
      },
    });
    const steps: Array<[OrderState, OrderState, string]> = [
      ["CREATED", "VALIDATED", REASONS.VALIDATED_OK],
      ["VALIDATED", "SUBMITTED", REASONS.SUBMIT_OK],
      ["SUBMITTED", "RECONCILING", REASONS.VENUE_ACK_LOST],
      ["RECONCILING", "UNKNOWN", REASONS.VENUE_ACK_LOST],
    ];
    let cur: OrderState = "CREATED";
    for (const [from, to, reason] of steps) {
      assertTransition(from, to, reason);
      await tx.orderEvent.create({ data: { orderId: order.id, fromState: from, toState: to, reason } });
      cur = to;
    }
    await tx.order.update({
      where: { id: order.id },
      data: { state: cur, stateReason: REASONS.VENUE_ACK_LOST },
    });
    await tx.reconciliationEntry.create({
      data: { orderId: order.id, venueOrderId: order.venueOrderId, kind: "UNKNOWN_STATE", detail: REASONS.VENUE_ACK_LOST },
    });
    enqueueOutbox(tx, [
      {
        aggregateType: "RECONCILIATION",
        aggregateId: order.id,
        eventType: "RECONCILIATION_OPENED",
        payload: { userId: user.id, reason: REASONS.VENUE_ACK_LOST },
      },
    ]);
    return order.id;
  });
  const { drainOutbox } = await import("@/lib/outbox");
  await drainOutbox(10);
  return orderId;
}

// Paper trading engine — the full order pipeline.
// eligibility (C4.5) -> risk checks (C10) -> idempotency (S-03) ->
// state machine (S-01) -> paper fill -> ledger (P-02) -> outbox (S-02)
// ALL writes happen in ONE prisma transaction. No dual-write window.
import { db } from "@/lib/db";
import { assertTransition, REASONS, type OrderState } from "@/lib/order-machine";
import { composeIdempotencyKey } from "@/lib/idempotency";
import { enqueueOutbox } from "@/lib/outbox";
import { DEFAULT_PAPER_FEE_SCHEDULE, feeForNotionalCents, isValidPriceCents, isValidSizeCents } from "@/lib/money";
import { isVenueTradeAllowed } from "@/lib/eligibility";
import { preTradeRiskChecks } from "@/lib/risk";

export interface PlacePaperOrderInput {
  userId: string;
  robotId?: string | null;
  marketId: string;
  side: "BUY_YES" | "BUY_NO";
  priceCents: number;
  sizeCents: number;
  nonce: string;
  trigger?: "SCHEDULE_TICK" | "MARKET_EVENT" | "MANUAL";
}

export interface PlaceOrderResult {
  ok: true;
  orderId: string;
  state: OrderState;
  idempotencyKey: string;
  duplicate: boolean;
}
export interface PlaceOrderRejection {
  ok: false;
  stage: "ELIGIBILITY" | "MARKET" | "RISK" | "VALIDATION" | "BALANCE";
  reason: string;
  details?: unknown;
}
export type PlaceOrderOutcome = PlaceOrderResult | PlaceOrderRejection;

function paperBalanceCents(userId: string): Promise<number> {
  return db.ledgerEntry
    .findMany({ where: { userId, mode: "PAPER" }, orderBy: { createdAt: "desc" }, take: 1 })
    .then((rows) => rows[0]?.balanceAfterCents ?? 0);
}

export async function placePaperOrder(input: PlacePaperOrderInput): Promise<PlaceOrderOutcome> {
  // ── 1. validation (cheap, local, pre-transaction) ────────────────────────
  if (!isValidPriceCents(input.priceCents) || !isValidSizeCents(input.sizeCents)) {
    return { ok: false, stage: "VALIDATION", reason: "price must be 1-100¢ integer; size must be positive integer cents" };
  }

  // ── 2. idempotency dedupe (S-03): same key returns the original order ────
  const idempotencyKey = composeIdempotencyKey({
    userId: input.userId,
    robotId: input.robotId,
    marketId: input.marketId,
    side: input.side,
    priceCents: input.priceCents,
    sizeCents: input.sizeCents,
    mode: "PAPER",
    nonce: input.nonce,
  });
  const existing = await db.order.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { ok: true, orderId: existing.id, state: existing.state as OrderState, idempotencyKey, duplicate: true };
  }

  // ── 3. eligibility (C4.5) ────────────────────────────────────────────────
  const elig = await isVenueTradeAllowed(input.userId);
  if (!elig.allowed) {
    return { ok: false, stage: "ELIGIBILITY", reason: elig.reason ?? "jurisdiction not eligible", details: elig };
  }

  // ── 4. market state ──────────────────────────────────────────────────────
  const market = await db.market.findUnique({ where: { id: input.marketId } });
  if (!market) return { ok: false, stage: "MARKET", reason: "market not found" };
  if (market.ambiguityFlag) {
    return { ok: false, stage: "MARKET", reason: REASONS.VALIDATION_FAIL_AMBIGUITY };
  }
  if (market.resolvedAt) {
    return { ok: false, stage: "MARKET", reason: "market already resolved" };
  }
  const bookPrice = input.side === "BUY_YES" ? market.yesPriceCents : market.noPriceCents;
  if (bookPrice == null) {
    return { ok: false, stage: "MARKET", reason: "no live price for the requested side" };
  }

  // ── 5. robot + balance + risk checks (C10) ───────────────────────────────
  const robot = input.robotId
    ? await db.robot.findUnique({ where: { id: input.robotId } })
    : null;
  if (input.robotId && !robot) return { ok: false, stage: "RISK", reason: "robot not found" };
  const balance = await paperBalanceCents(input.userId);
  const riskChecks = robot
    ? await preTradeRiskChecks({
        userId: input.userId,
        robot,
        marketId: input.marketId,
        sizeCents: input.sizeCents,
        balanceCents: balance,
      })
    : [];
  const failedRisk = riskChecks.find((c) => !c.passed);
  if (failedRisk) {
    return { ok: false, stage: "RISK", reason: `risk check failed: ${failedRisk.check} — ${failedRisk.detail}`, details: riskChecks };
  }

  // ── 6. the transactional pipeline ────────────────────────────────────────
  const feeCents = feeForNotionalCents(input.sizeCents, DEFAULT_PAPER_FEE_SCHEDULE, false);
  const created = await db.$transaction(async (tx) => {
    // strategy version pin (C5)
    let strategyVersionId: string | null = null;
    if (robot) {
      const sv = await tx.strategyVersion.findFirst({
        where: { robotId: robot.id, version: robot.activeVersion },
      });
      strategyVersionId = sv?.id ?? null;
    }

    const order = await tx.order.create({
      data: {
        userId: input.userId,
        robotId: input.robotId ?? null,
        marketId: input.marketId,
        strategyVersionId,
        mode: "PAPER",
        side: input.side,
        state: "CREATED",
        priceCents: input.priceCents,
        sizeCents: input.sizeCents,
        feeCents,
        venueOrderId: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        idempotencyKey,
      },
    });

    const drafts: Parameters<typeof enqueueOutbox>[1] = [];
    const step = async (from: OrderState, to: OrderState, reason: string) => {
      assertTransition(from, to, reason); // throws on illegal edge — by design
      await tx.orderEvent.create({
        data: { orderId: order.id, fromState: from, toState: to, reason },
      });
      drafts.push({
        aggregateType: "ORDER",
        aggregateId: order.id,
        eventType: "ORDER_STATE_CHANGED",
        payload: { from, to, reason, userId: input.userId },
      });
      return to;
    };

    let state: OrderState = "CREATED";
    state = await step(state, "VALIDATED", REASONS.VALIDATED_OK) as OrderState;
    state = await step(state, "SUBMITTED", REASONS.SUBMIT_OK) as OrderState;
    // paper venue: immediate full fill at book price
    state = await step(state, "FILLED", REASONS.FILL_COMPLETE) as OrderState;

    await tx.order.update({
      where: { id: order.id },
      data: { state, filledCents: input.sizeCents, feeCents },
    });

    await tx.fill.create({
      data: {
        orderId: order.id,
        priceCents: input.priceCents,
        sizeCents: input.sizeCents,
        feeCents,
        venue: "PAPER_BOOK",
      },
    });

    // position upsert
    const posSide = input.side === "BUY_YES" ? "YES" : "NO";
    const existingPos = input.robotId
      ? await tx.position.findFirst({
          where: { robotId: input.robotId, marketId: input.marketId, side: posSide, status: "OPEN" },
        })
      : null;
    if (existingPos && input.robotId) {
      const totalSize = existingPos.sizeCents + input.sizeCents;
      const avg = Math.round(
        (existingPos.avgPriceCents * existingPos.sizeCents + input.priceCents * input.sizeCents) / totalSize,
      );
      await tx.position.update({
        where: { id: existingPos.id },
        data: { sizeCents: totalSize, avgPriceCents: avg },
      });
    } else if (input.robotId) {
      await tx.position.create({
        data: {
          robotId: input.robotId,
          marketId: input.marketId,
          side: posSide,
          sizeCents: input.sizeCents,
          avgPriceCents: input.priceCents,
        },
      });
    }

    // ledger (P-02): FILL debit + FEE, with running balance
    const last = await tx.ledgerEntry.findFirst({
      where: { userId: input.userId, mode: "PAPER" },
      orderBy: { createdAt: "desc" },
    });
    let bal = last?.balanceAfterCents ?? 0;
    const append = async (type: string, amount: number, memo: string, refId: string) => {
      bal += amount;
      await tx.ledgerEntry.create({
        data: {
          userId: input.userId,
          mode: "PAPER",
          type,
          amountCents: amount,
          balanceAfterCents: bal,
          refId,
          memo,
        },
      });
      drafts.push({
        aggregateType: "LEDGER",
        aggregateId: order.id,
        eventType: "LEDGER_APPENDED",
        payload: { type, amount, memo },
      });
    };
    await append("FILL", -input.sizeCents, `${input.side} ${input.sizeCents}¢ @ ${input.priceCents}¢ on ${market.question.slice(0, 60)}`, order.id);
    if (feeCents > 0) await append("FEE", -feeCents, "taker fee", order.id);

    enqueueOutbox(tx, drafts);
    return order;
  });

  await drainQuietly();
  return { ok: true, orderId: created.id, state: "FILLED", idempotencyKey, duplicate: false };
}

async function drainQuietly(): Promise<void> {
  try {
    const { drainOutbox } = await import("@/lib/outbox");
    await drainOutbox(25);
  } catch {
    // dispatcher failure never affects the trade path
  }
}

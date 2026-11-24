// Paper trading engine — the full order pipeline.
// eligibility (C4.5) -> risk checks (C10) -> idempotency (S-03) ->
// state machine (S-01) -> paper fill -> ledger (P-02) -> outbox (S-02)
// ALL writes happen in ONE prisma transaction. No dual-write window.
import { db } from "@/lib/db";
import { assertTransition, REASONS, type OrderState } from "@/lib/order-machine";
import { composeIdempotencyKey } from "@/lib/idempotency";
import { enqueueOutbox } from "@/lib/outbox";
import { isValidPriceCents, isValidSizeCents } from "@/lib/money";
import { isVenueTradeAllowed } from "@/lib/eligibility";
import { preTradeRiskChecks } from "@/lib/risk";
import { getPauseState } from "@/lib/control";

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
  stage: "PLATFORM" | "ELIGIBILITY" | "MARKET" | "RISK" | "VALIDATION" | "BALANCE";
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

  // ── 1b. global pause gate (C19/S-07): no order path bypasses the switch ──
  const pause = await getPauseState();
  if (pause.paused) {
    return { ok: false, stage: "PLATFORM", reason: `platform paused: ${pause.reason ?? "manual pause"}` };
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

  // ── 5. robot + balance + risk checks (C10 + Phase 4 venue structural rules)
  //    robot is null for manual tickets: robot-scoped checks are skipped, but
  //    the venue's structural entry rules (touch depth, per-market cap) still
  //    apply — thin books refuse humans and robots alike.
  const robot = input.robotId
    ? await db.robot.findUnique({ where: { id: input.robotId } })
    : null;
  if (input.robotId && !robot) return { ok: false, stage: "RISK", reason: "robot not found" };
  const balance = await paperBalanceCents(input.userId);
  const riskChecks = await preTradeRiskChecks({
    userId: input.userId,
    robot,
    marketId: input.marketId,
    side: input.side,
    sizeCents: input.sizeCents,
    balanceCents: balance,
  });
  const failedRisk = riskChecks.find((c) => !c.passed);
  if (failedRisk) {
    return { ok: false, stage: "RISK", reason: `risk check failed: ${failedRisk.check} — ${failedRisk.detail}`, details: riskChecks };
  }

  // ── 6. the transactional pipeline ────────────────────────────────────────
  // Fee schedule is config, never hardcoded (C4.4): the venue taker bps were
  // computed from the documented fee regime at sync and stored on the market.
  // Paper fills charge them so paper P/L matches what a live taker would pay.
  const entryBps = (input.side === "BUY_YES" ? market.yesTakerFeeBps : market.noTakerFeeBps) ?? 0;
  const feeCents = Math.floor((input.sizeCents * entryBps) / 10000);
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

    // position upsert — robot positions are keyed by robot, manual paper
    // positions (no robot) by their owner; every new row records its owner.
    const posSide = input.side === "BUY_YES" ? "YES" : "NO";
    const existingPos = await tx.position.findFirst({
      where: input.robotId
        ? { robotId: input.robotId, marketId: input.marketId, side: posSide, status: "OPEN" }
        : { robotId: null, userId: input.userId, marketId: input.marketId, side: posSide, status: "OPEN" },
    });
    if (existingPos) {
      const totalSize = existingPos.sizeCents + input.sizeCents;
      const avg = Math.round(
        (existingPos.avgPriceCents * existingPos.sizeCents + input.priceCents * input.sizeCents) / totalSize,
      );
      await tx.position.update({
        where: { id: existingPos.id },
        data: { sizeCents: totalSize, avgPriceCents: avg },
      });
    } else {
      await tx.position.create({
        data: {
          robotId: input.robotId ?? null,
          userId: input.userId,
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
    if (feeCents > 0) await append("FEE", -feeCents, `${market.venue} taker fee ${entryBps}bps`, order.id);

    await enqueueOutbox(tx, drafts);
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

// ── Closing a paper position ────────────────────────────────────────────────
// Sells the whole position at the venue's current price for that side (the
// paper book's mark). One transaction:
//   exit order (SELL_YES / SELL_NO, FILLED; sizeCents = cost basis,
//   filledCents = proceeds) + fill + ledger:
//     CLOSE      +cost basis   (cash returned)
//     SETTLEMENT +/- realized P&L (proceeds − cost basis; what the risk engine
//                 counts as realized profit or loss)
//     FEE        −exit taker fee (venue fee snapshot)
//   and the position marked CLOSED. The idempotency key is the position id, so
//   a position can only ever be closed once, whoever triggers it.
export type ClosePositionResult =
  | { ok: true; orderId: string; proceedsCents: number; pnlCents: number; feeCents: number }
  | { ok: false; reason: string };

export async function closePaperPosition(input: { positionId: string; reason: string }): Promise<ClosePositionResult> {
  const pos = await db.position.findUnique({ where: { id: input.positionId }, include: { market: true, robot: { select: { userId: true } } } });
  if (!pos) return { ok: false, reason: "position not found" };
  if (pos.status !== "OPEN") return { ok: false, reason: `position is already ${pos.status.toLowerCase()}` };
  const ownerId = pos.userId ?? pos.robot?.userId;
  if (!ownerId) return { ok: false, reason: "position has no owner" };
  const mark = pos.side === "YES" ? pos.market.yesPriceCents : pos.market.noPriceCents;
  if (mark == null || mark < 0 || mark > 100) return { ok: false, reason: "no current price for this side — sync the venue first" };
  if (pos.avgPriceCents <= 0) return { ok: false, reason: "invalid entry price" };

  const proceeds = Math.round((pos.sizeCents * mark) / pos.avgPriceCents);
  const pnl = proceeds - pos.sizeCents;
  const bps = (pos.side === "YES" ? pos.market.yesTakerFeeBps : pos.market.noTakerFeeBps) ?? 0;
  const fee = Math.floor((proceeds * bps) / 10000);
  const exitSide = pos.side === "YES" ? "SELL_YES" : "SELL_NO";

  try {
    const order = await db.$transaction(async (tx) => {
      const fresh = await tx.position.findUnique({ where: { id: pos.id } });
      if (!fresh || fresh.status !== "OPEN") throw new Error("ALREADY_CLOSED");
      const order = await tx.order.create({
        data: {
          userId: ownerId,
          robotId: pos.robotId,
          marketId: pos.marketId,
          mode: "PAPER",
          side: exitSide,
          state: "FILLED",
          stateReason: input.reason.slice(0, 240),
          priceCents: Math.max(1, Math.min(100, mark)),
          sizeCents: pos.sizeCents,
          filledCents: proceeds,
          feeCents: fee,
          venueOrderId: `paper_exit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          idempotencyKey: `exit_${pos.id}`,
        },
      });
      await tx.orderEvent.create({ data: { orderId: order.id, fromState: "CREATED", toState: "FILLED", reason: `paper exit: ${input.reason}`.slice(0, 240) } });
      await tx.fill.create({ data: { orderId: order.id, priceCents: Math.max(1, Math.min(100, mark)), sizeCents: proceeds, feeCents: fee, venue: "PAPER_BOOK" } });
      const last = await tx.ledgerEntry.findFirst({ where: { userId: ownerId, mode: "PAPER" }, orderBy: { createdAt: "desc" } });
      let bal = last?.balanceAfterCents ?? 0;
      const append = async (type: string, amount: number, memo: string) => {
        bal += amount;
        await tx.ledgerEntry.create({ data: { userId: ownerId, mode: "PAPER", type, amountCents: amount, balanceAfterCents: bal, refId: order.id, memo } });
      };
      const q = pos.market.question.slice(0, 60);
      await append("CLOSE", pos.sizeCents, `cost basis returned · ${pos.side} on ${q}`);
      await append("SETTLEMENT", pnl, `realized ${pnl >= 0 ? "gain" : "loss"} · exit ${pos.side} @ ${mark}¢ (entry ${pos.avgPriceCents}¢) on ${q}`);
      if (fee > 0) await append("FEE", -fee, `${pos.market.venue} exit taker fee ${bps}bps`);
      await tx.position.update({ where: { id: pos.id }, data: { status: "CLOSED", closedAt: new Date() } });
      await enqueueOutbox(tx, [{ aggregateType: "ORDER", aggregateId: order.id, eventType: "POSITION_CLOSED", payload: { positionId: pos.id, pnl, proceeds, fee, reason: input.reason, userId: ownerId } }]);
      return order;
    });
    await drainQuietly();
    return { ok: true, orderId: order.id, proceedsCents: proceeds, pnlCents: pnl, feeCents: fee };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (msg.includes("ALREADY_CLOSED") || msg.includes("Unique constraint")) return { ok: false, reason: "position was already closed" };
    return { ok: false, reason: msg.slice(0, 200) };
  }
}

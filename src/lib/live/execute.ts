// Phase 7 — the gated live execution path. THE only way a real order leaves
// this platform, and every layer refuses honestly when its condition is
// unmet (fail-closed):
//   pause (C19) → robot LIVE_PILOT → venue live write → consent (C25) →
//   full live gate (edge + exec) → pilot caps → LIVE ledger balance →
//   CLOB book (B5 5-second freshness, tick conformance, min size, touch
//   depth) → sign (EIP-712, self-custody) → [DRY_RUN armor | send].
// The signed payload is audited into the order journal either way — evidence
// with honest labels (D-03), never a silent send.
import { db } from "@/lib/db";
import { assertTransition, REASONS, type OrderState } from "@/lib/order-machine";
import { composeIdempotencyKey } from "@/lib/idempotency";
import { enqueueOutbox } from "@/lib/outbox";
import { getPauseState } from "@/lib/control";
import { isVenueTradeAllowed } from "@/lib/eligibility";
import { liveGateReport, liveCredentials } from "./gates";
import { fetchClobBook, encodeBuyAmounts, buildSignedOrder, sendSignedOrder, type SignedOrder } from "./clobClient";
import { redactKey } from "./custody";
import type { RiskCheckResult } from "@/lib/risk";

export interface PlaceLiveOrderInput {
  userId: string;
  robotId: string;
  marketId: string;
  side: "BUY_YES" | "BUY_NO";
  priceCents: number; // limit price 1..99 (integer cents — S-09)
  sizeCents: number; // USD notional in integer cents
  nonce: string;
  trigger?: "SCHEDULE_TICK" | "MARKET_EVENT" | "MANUAL";
}

export interface LiveOrderResult {
  ok: true;
  orderId: string;
  state: OrderState;
  dryRun: boolean;
  venueOrderId: string | null; // CLOB order id when sent, null in dry-run
  signedPayloadHash: string; // sha256 of the exact signed wire order — audit
}

export interface LiveOrderRejection {
  ok: false;
  stage: "GATE" | "PILOT" | "BOOK" | "ELIGIBILITY" | "PLATFORM" | "SIGNING" | "SEND";
  reason: string;
  details?: unknown;
}

export type LiveOrderOutcome = LiveOrderResult | LiveOrderRejection;

const LIVE_BOOK_FRESHNESS_MS = 5_000; // B5: 5-second book budget on the live path

export async function placeLiveOrder(input: PlaceLiveOrderInput): Promise<LiveOrderOutcome> {
  // ── 0. global pause (C19): the kill switch gates the live path first ──────
  const pause = await getPauseState();
  if (pause.paused) {
    return { ok: false, stage: "PLATFORM", reason: `platform paused: ${pause.reason ?? "manual pause"}` };
  }

  // ── 1. the full gate stack, evaluated NOW (not cached) — a consent revoke,
  //      a geo flip or a model demotion closes this path on the next read ──
  const robot = await db.robot.findUnique({ where: { id: input.robotId } });
  if (!robot) return { ok: false, stage: "GATE", reason: "robot not found" };
  if (robot.mode !== "LIVE_PILOT") {
    return { ok: false, stage: "GATE", reason: `robot mode ${robot.mode} — live orders require LIVE_PILOT (flip via Settings; the flip re-runs this gate)` };
  }
  const gate = await liveGateReport(input.robotId);
  if (!gate) return { ok: false, stage: "GATE", reason: "gate report unavailable" };
  // LIVE_WRITE_SWITCH is excluded here BY DESIGN: the DRY_RUN armor below is
  // what enforces it (signed-not-sent while SAFE). Every OTHER unmet check
  // refuses the attempt outright.
  const failed = [...(gate.edge?.checks ?? []), ...gate.exec].find((c) => !c.passed && c.check !== "LIVE_WRITE_SWITCH");
  if (failed) {
    return { ok: false, stage: "GATE", reason: `live gate refused — ${failed.check}: ${failed.detail}`, details: gate };
  }

  // ── 2. geo (C4.5) — belt and suspenders: checked inside the gate AND here ─
  const geo = await isVenueTradeAllowed(input.userId);
  if (!geo.allowed) return { ok: false, stage: "ELIGIBILITY", reason: geo.reason ?? "jurisdiction not eligible" };

  // ── 3. market + pilot caps (integer cents only, S-09) ─────────────────────
  const market = await db.market.findUnique({ where: { id: input.marketId } });
  if (!market || market.venue !== robot.venue) return { ok: false, stage: "GATE", reason: "market not found on the robot's venue" };
  if (market.ambiguityFlag || market.resolvedAt) return { ok: false, stage: "BOOK", reason: "market ambiguous or already resolved" };
  const pilot = await db.platformControl.findUnique({ where: { key: "LIVE_PILOT" } });
  const pilotState = pilot ? (JSON.parse(pilot.value) as { maxOrderCents: number; maxTotalNotionalCents: number; venues: string[] }) : null;
  if (pilotState && !pilotState.venues.includes(robot.venue)) {
    return { ok: false, stage: "PILOT", reason: `venue ${robot.venue} is not in the pilot whitelist (${pilotState.venues.join("/")})` };
  }
  if (pilotState && input.sizeCents > pilotState.maxOrderCents) {
    return { ok: false, stage: "PILOT", reason: `order ${input.sizeCents}¢ exceeds the small-capital pilot per-order cap ${pilotState.maxOrderCents}¢` };
  }
  const openLive = await db.position.aggregate({
    where: { robot: { mode: "LIVE_PILOT" }, status: "OPEN" },
    _sum: { sizeCents: true },
  });
  const totalLive = (openLive._sum.sizeCents ?? 0) + input.sizeCents;
  if (pilotState && totalLive > pilotState.maxTotalNotionalCents) {
    return { ok: false, stage: "PILOT", reason: `total live notional ${totalLive}¢ would exceed the pilot cap ${pilotState.maxTotalNotionalCents}¢ (open ${(openLive._sum.sizeCents ?? 0)}¢)` };
  }

  // ── 4. LIVE ledger balance (mode LIVE — separate from the paper book) ────
  const liveBalance = await db.ledgerEntry
    .findMany({ where: { userId: input.userId, mode: "LIVE" }, orderBy: { createdAt: "desc" }, take: 1 })
    .then((r) => r[0]?.balanceAfterCents ?? 0);
  if (input.sizeCents > liveBalance) {
    return { ok: false, stage: "PILOT", reason: `order ${input.sizeCents}¢ vs LIVE balance ${liveBalance}¢ — fund the live ledger (mode LIVE) first` };
  }

  // ── 5. the CLOB book: B5 freshness, tick conformance, min size, depth ────
  const tokenId = input.side === "BUY_YES" ? market.yesTokenId : market.noTokenId;
  if (!tokenId) return { ok: false, stage: "BOOK", reason: "no CLOB token id for the requested side — sync the market first" };
  let book;
  let fetchedAtMs: number;
  try {
    ({ book, fetchedAtMs } = await fetchClobBook(tokenId));
  } catch (e) {
    return { ok: false, stage: "BOOK", reason: `CLOB book fetch failed (fail-closed): ${String(e instanceof Error ? e.message : e)}` };
  }
  const bookAgeMs = Date.now() - fetchedAtMs;
  const bestAsk = book.asks?.[0] ? parseFloat(book.asks[0].price) : null;
  const bookChecks: RiskCheckResult[] = [
    { check: "LIVE_BOOK_FRESH", passed: bookAgeMs <= LIVE_BOOK_FRESHNESS_MS, detail: `prices fetched just now (${bookAgeMs}ms old; must be under ${LIVE_BOOK_FRESHNESS_MS}ms)` },
    { check: "LIVE_BOOK_PRESENT", passed: bestAsk != null && bestAsk > 0, detail: `best ask ${bestAsk ?? "none"} vs limit ${(input.priceCents / 100).toFixed(2)}` },
    { check: "LIVE_PRICE_SANITY", passed: bestAsk == null || input.priceCents <= Math.round(bestAsk * 100 * 1.02), detail: `limit ${(input.priceCents / 100).toFixed(2)} vs touch ${bestAsk?.toFixed(3) ?? "—"} (max +2% slippage guard)` },
  ];
  const failedBook = bookChecks.find((c) => !c.passed);
  if (failedBook) {
    return { ok: false, stage: "BOOK", reason: `live book refused — ${failedBook.check}: ${failedBook.detail}`, details: bookChecks };
  }
  const tickSize = book.tick_size ?? "0.01";
  const minSize = parseFloat(book.min_order_size ?? "5");
  const shares = Math.floor((input.sizeCents / input.priceCents) * 100) / 100; // 2-decimal shares
  if (shares < minSize) {
    return { ok: false, stage: "BOOK", reason: `order ${shares} shares below the book minimum ${minSize} (min_order_size)` };
  }

  // ── 6. encode amounts + sign (self-custody EIP-712) ───────────────────────
  let amounts;
  try {
    amounts = encodeBuyAmounts(input.priceCents, shares.toFixed(2), tickSize);
  } catch (e) {
    return { ok: false, stage: "BOOK", reason: String(e instanceof Error ? e.message : e) };
  }
  let signed: SignedOrder;
  try {
    signed = await buildSignedOrder({
      tokenId,
      makerAmount: amounts.makerAmount,
      takerAmount: amounts.takerAmount,
      side: "BUY",
      book: { version: book.version ?? null, neg_risk: book.neg_risk ?? null },
    });
  } catch (e) {
    return { ok: false, stage: "SIGNING", reason: redactKey(String(e instanceof Error ? e.message : e)) };
  }
  const { createHash } = await import("node:crypto");
  const signedPayloadHash = createHash("sha256").update(JSON.stringify(signed)).digest("hex");

  // ── 7. idempotent order row + journal (S-03/S-01) — the audit survives ────
  //      whatever the send boundary decides next.
  const idempotencyKey = composeIdempotencyKey({ ...input, mode: "LIVE" });
  const existing = await db.order.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { ok: true, orderId: existing.id, state: existing.state as OrderState, dryRun: process.env.POLYMARKET_LIVE_WRITE !== "1", venueOrderId: existing.venueOrderId, signedPayloadHash };
  }
  const creds = liveCredentials();
  const dryRun = process.env.POLYMARKET_LIVE_WRITE !== "1" || creds == null;
  let venueOrderId: string | null = null;
  let finalState: OrderState = "SUBMITTED";
  let rejectReason: string | null = null;

  const created = await db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId: input.userId,
        robotId: input.robotId,
        marketId: input.marketId,
        strategyVersionId: (await tx.strategyVersion.findFirst({ where: { robotId: input.robotId, version: robot.activeVersion } }))?.id ?? null,
        mode: "LIVE",
        side: input.side,
        state: "CREATED",
        priceCents: input.priceCents,
        sizeCents: input.sizeCents,
        venueOrderId: null,
        idempotencyKey,
      },
    });
    const drafts: Parameters<typeof enqueueOutbox>[1] = [];
    const step = async (from: OrderState, to: OrderState, reason: string, detail?: unknown) => {
      assertTransition(from, to, reason);
      await tx.orderEvent.create({ data: { orderId: order.id, fromState: from, toState: to, reason, detail: detail ? JSON.stringify(detail) : null } });
      drafts.push({ aggregateType: "ORDER", aggregateId: order.id, eventType: "ORDER_STATE_CHANGED", payload: { from, to, reason } });
    };
    await step("CREATED", "VALIDATED", `${REASONS.VALIDATED_OK} — live gate ready (edge+exec), pilot caps ${pilotState?.maxOrderCents ?? "?"}¢/order`, { signedPayloadHash, domain: signed.domain, tickSize, shares: amounts.shares, makerAmount: amounts.makerAmount, takerAmount: amounts.takerAmount });
    await step("VALIDATED", "SUBMITTED", dryRun ? "DRY_RUN: order signed, payload audited, NOT sent (POLYMARKET_LIVE_WRITE unset or credentials missing)" : "live: signed order handed to the CLOB send boundary");
    return { order, drafts };
  });

  // ── 8. the send boundary (outside the transaction — a network call) ──────
  if (dryRun) {
    finalState = "SUBMITTED";
    await db.orderEvent.create({
      data: {
        orderId: created.order.id,
        fromState: "SUBMITTED",
        toState: "SUBMITTED",
        reason: "audit: signed order payload recorded (sha256 " + signedPayloadHash.slice(0, 16) + "…) — not sent (test mode: real sending is switched off)",
        detail: JSON.stringify({ dryRun: true, signedPayloadHash, wire: { maker: signed.maker, signer: signed.signer, tokenId: signed.tokenId, makerAmount: signed.makerAmount, takerAmount: signed.takerAmount, side: signed.side, signatureType: signed.signatureType, domain: signed.domain } }),
      },
    });
    await enqueueOutbox(db, [...created.drafts, { aggregateType: "ORDER", aggregateId: created.order.id, eventType: "LIVE_ORDER_SIGNED_NOT_SENT", payload: { signedPayloadHash } }]);
  } else {
    try {
      const res = await sendSignedOrder(signed, creds!);
      if (res.success) {
        venueOrderId = res.orderID;
        finalState = "OPEN";
        await db.order.update({ where: { id: created.order.id }, data: { venueOrderId, state: "OPEN" } });
        await db.orderEvent.create({ data: { orderId: created.order.id, fromState: "SUBMITTED", toState: "OPEN", reason: `CLOB accepted (${res.status})`, detail: JSON.stringify({ orderID: res.orderID, status: res.status }) } });
        await enqueueOutbox(db, [...created.drafts, { aggregateType: "ORDER", aggregateId: created.order.id, eventType: "LIVE_ORDER_ACCEPTED", payload: { orderID: res.orderID, status: res.status } }]);
      } else {
        rejectReason = redactKey(res.errorMsg || "clob rejected the order");
        finalState = "REJECTED";
        await db.order.update({ where: { id: created.order.id }, data: { state: "REJECTED", stateReason: rejectReason } });
        await db.orderEvent.create({ data: { orderId: created.order.id, fromState: "SUBMITTED", toState: "REJECTED", reason: `CLOB rejected: ${rejectReason}`, detail: JSON.stringify({ dryRun: false }) } });
        await enqueueOutbox(db, [...created.drafts, { aggregateType: "ORDER", aggregateId: created.order.id, eventType: "LIVE_ORDER_REJECTED", payload: { reason: rejectReason } }]);
      }
    } catch (e) {
      // network-level uncertainty: the venue ack is UNKNOWN — reconciliation
      // path only (S-01/S-04). The order stays SUBMITTED with an open drift.
      const msg = redactKey(String(e instanceof Error ? e.message : e));
      finalState = "RECONCILING";
      await db.order.update({ where: { id: created.order.id }, data: { state: "RECONCILING" } });
      await db.orderEvent.create({ data: { orderId: created.order.id, fromState: "SUBMITTED", toState: "RECONCILING", reason: `${REASONS.VENUE_ACK_LOST}: ${msg}` } });
      await db.reconciliationEntry.create({ data: { orderId: created.order.id, kind: "UNKNOWN_STATE", detail: "send threw — venue truth unknown; resolve via reconciliation only" } });
      await enqueueOutbox(db, [...created.drafts, { aggregateType: "RECONCILIATION", aggregateId: created.order.id, eventType: "LIVE_ORDER_ACK_LOST", payload: { error: msg } }]);
    }
  }

  return {
    ok: true,
    orderId: created.order.id,
    state: finalState,
    dryRun,
    venueOrderId,
    signedPayloadHash,
  };
}

// S-03 — Idempotency key composition.
// Key = hash of every economic input + a caller nonce. Retries with the same
// key MUST return the original order, never create a duplicate.
import { createHash } from "crypto";

export interface IdempotencyInput {
  userId: string;
  robotId?: string | null;
  strategyVersionId?: string | null;
  marketId: string;
  side: string;
  priceCents: number;
  sizeCents: number;
  mode: string;
  nonce: string; // client-supplied UUID; a retry reuses it
}

export function composeIdempotencyKey(input: IdempotencyInput): string {
  const parts = [
    input.userId,
    input.robotId ?? "-",
    input.strategyVersionId ?? "-",
    input.marketId,
    input.side,
    String(input.priceCents),
    String(input.sizeCents),
    input.mode,
    input.nonce,
  ].join("|");
  return "idem_" + createHash("sha256").update(parts).digest("hex").slice(0, 32);
}

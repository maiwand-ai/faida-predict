// S-09 — Money math. All amounts are integer cents. Floats never touch money.
export const MIN_PRICE_CENTS = 1;
export const MAX_PRICE_CENTS = 100; // Polymarket contracts settle at 100¢/0¢

export function isValidPriceCents(p: number): boolean {
  return Number.isInteger(p) && p >= MIN_PRICE_CENTS && p <= MAX_PRICE_CENTS;
}

export function isValidSizeCents(s: number): boolean {
  return Number.isInteger(s) && s > 0;
}

// Yes/No parity: the two sides of one contract must sum to exactly 100¢.
export function parityGapCents(yes: number, no: number): number {
  return 100 - (yes + no);
}

// C4.4 — fee schedule is configuration, never hardcoded at call sites.
export interface FeeSchedule {
  takerBps: number; // basis points of notional
  makerBps: number;
}
export const DEFAULT_PAPER_FEE_SCHEDULE: FeeSchedule = { takerBps: 0, makerBps: 0 };

export function feeForNotionalCents(notionalCents: number, schedule: FeeSchedule, maker: boolean): number {
  const bps = maker ? schedule.makerBps : schedule.takerBps;
  return Math.floor((notionalCents * bps) / 10000);
}

// Contracts received for a BUY at price p with notional s (integer floor).
export function contractsForCents(sizeCents: number, priceCents: number): number {
  if (priceCents <= 0) return 0;
  return Math.floor((sizeCents * 100) / priceCents); // in 1/100 contract units ×100
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function formatPrice(cents: number): string {
  return `${cents}¢`;
}

// Settled value of a position: YES pays 100 if outcome YES, else 0.
export function settlementValueCents(side: "YES" | "NO", contractsX100: number, outcome: "YES" | "NO"): number {
  const contracts = contractsX100 / 100;
  const won = side === outcome;
  return won ? Math.round(contracts * 100) : 0;
}

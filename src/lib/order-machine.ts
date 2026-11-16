// S-01 — Order state machine with the UNKNOWN state and reconciliation path.
// Every transition must go through transitionOrder(); illegal transitions throw.

export const ORDER_STATES = [
  "CREATED",
  "VALIDATED",
  "SUBMITTED",
  "OPEN",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "RECONCILING",
  "UNKNOWN",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export const TERMINAL_STATES: OrderState[] = ["FILLED", "CANCELLED", "REJECTED", "EXPIRED"];

// Legal edges of the machine. RECONCILING/UNKNOWN exist precisely so a lost
// venue ack never invents a fill and never silently disappears (rule 5).
export const TRANSITIONS: Record<OrderState, OrderState[]> = {
  CREATED: ["VALIDATED", "REJECTED"], // validation runs locally, pre-venue
  VALIDATED: ["SUBMITTED", "CANCELLED", "REJECTED"],
  SUBMITTED: ["OPEN", "PARTIALLY_FILLED", "FILLED", "REJECTED", "RECONCILING", "UNKNOWN"],
  OPEN: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED", "RECONCILING", "UNKNOWN"],
  PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED", "RECONCILING", "UNKNOWN"],
  FILLED: [], // terminal
  CANCELLED: [], // terminal
  REJECTED: [], // terminal
  EXPIRED: [], // terminal
  RECONCILING: ["UNKNOWN", "FILLED", "CANCELLED", "REJECTED"],
  UNKNOWN: ["FILLED", "CANCELLED", "REJECTED"], // only reconciliation evidence resolves UNKNOWN
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function isTerminal(s: OrderState): boolean {
  return TERMINAL_STATES.includes(s);
}

export interface TransitionResult {
  from: OrderState;
  to: OrderState;
  reason: string;
}

export function assertTransition(from: OrderState, to: OrderState, reason: string): TransitionResult {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal order transition ${from} -> ${to} (${reason})`);
  }
  return { from, to, reason };
}

// Human-readable, greppable reason taxonomy (D-04: status is word + glyph).
export const REASONS = {
  VALIDATED_OK: "validation passed",
  VALIDATION_FAIL_ELIGIBILITY: "rejected: venue/jurisdiction eligibility",
  VALIDATION_FAIL_AMBIGUITY: "rejected: market flagged for ambiguous resolution",
  VALIDATION_FAIL_RISK: "rejected: risk limits",
  VALIDATION_FAIL_BALANCE: "rejected: insufficient balance",
  SUBMIT_OK: "submitted to venue",
  FILL_COMPLETE: "fill complete",
  FILL_PARTIAL: "partial fill",
  CANCELLED_BY_USER: "cancelled by user",
  CANCELLED_BY_RISK: "cancelled by risk engine",
  VENUE_REJECT: "venue rejected order",
  VENUE_ACK_LOST: "venue acknowledgement lost — entering reconciliation",
  RECONCILE_MATCHED_FILL: "reconciliation: venue reports fill",
  RECONCILE_MATCHED_CANCEL: "reconciliation: venue reports cancellation",
  RECONCILE_NOT_FOUND: "reconciliation: order not found on venue — treated as rejected",
  EXPIRED_TTL: "order expired (time in force)",
} as const;

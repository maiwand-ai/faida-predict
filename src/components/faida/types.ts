// Shared DTOs between API routes and the UI.

export interface RobotDTO {
  id: string;
  name: string;
  family: string;
  status: string;
  statusReason: string | null;
  paperMode: boolean;
  allocatedCents: number;
  maxPositionCents: number;
  maxOpenPositions: number;
  dailyLossStopPct: number;
  drawdownStopPct: number;
  activeVersion: number;
}

export interface OrderRowDTO {
  id: string;
  marketId: string;
  side: string;
  state: string;
  stateReason: string | null;
  priceCents: number;
  sizeCents: number;
  filledCents: number;
  feeCents: number;
  createdAt: string;
  market?: { question: string };
  robot?: { name: string } | null;
}

export interface LedgerRowDTO {
  id: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  memo: string | null;
  createdAt: string;
}

export interface TraceDTO {
  id: string;
  decision: string;
  reason: string;
  modelEstimatePct: number | null;
  marketPriceCents: number | null;
  edgeNetPct: number | null;
  riskChecks: string;
  createdAt: string;
  robot?: { name: string };
  market?: { question: string };
}

export interface PositionRowDTO {
  id: string;
  side: string;
  sizeCents: number;
  avgPriceCents: number;
  market?: { question: string; yesPriceCents: number | null };
  robot?: { name: string };
}

export interface ProviderDTO {
  id: string;
  name: string;
  model: string;
  enabled: boolean;
  priority: number;
  hasKey: boolean;
  keyMasked: string | null;
  baseUrl: string | null;
  monthlyBudgetCents: number;
  spentCents: number;
}

export interface DashboardDTO {
  user: { id: string; name: string | null; email: string; country: string };
  wallet: { address: string; signingModel: string } | null;
  balanceCents: number;
  exposureCents: number;
  exposureLimitPct: number;
  allocatedCents: number;
  todayFlowCents: number;
  robots: RobotDTO[];
  orders: OrderRowDTO[];
  positions: PositionRowDTO[];
  traces: TraceDTO[];
  notifications: Array<{ id: string; severity: string; family: string; title: string; body: string; createdAt: string }>;
  marketCount: number;
  outboxPending: number;
  providers: ProviderDTO[];
  risk: Array<{ scope: string; key: string; valueNum: number }>;
}

export interface MarketDTO {
  id: string;
  venueSymbol: string;
  question: string;
  category: string;
  yesPriceCents: number | null;
  noPriceCents: number | null;
  liquidityCents: number | null;
  volumeCents: number | null;
  closeDate: string | null;
  ambiguityFlag: boolean;
  dataSource: string;
}

export interface EligibilityRuleDTO {
  id: string;
  country: string;
  allowed: boolean;
  reason: string | null;
  source: string;
}

export interface RiskViewDTO {
  effective: {
    dailyLossStopPct: number;
    drawdownStopPct: number;
    perEventExposurePct: number;
    aiMonthlyBudgetCents: number;
  };
  platformMax: Record<string, number>;
}

export const FAMILIES = [
  { id: "PROBABILITY_EDGE", label: "Probability Edge", desc: "Enter when model-vs-market edge exceeds a threshold, net of fees." },
  { id: "MARKET_MAKING", label: "Market-Making", desc: "Quote both sides around a fair value; earn the spread and maker rebates." },
  { id: "AI_RESEARCH", label: "AI Research", desc: "LLM-driven evidence gathering with sourced citations; trades only after the edge gate." },
  { id: "ARBITRAGE", label: "Arbitrage (planned)", desc: "YES+NO parity and clustered offsets — deterministic edge, later phase." },
] as const;

export const FAMILY_LABEL: Record<string, string> = Object.fromEntries(
  FAMILIES.map((f) => [f.id, f.label]),
);

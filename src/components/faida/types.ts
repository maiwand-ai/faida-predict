// Shared DTOs between API routes and the UI.

export interface RobotDTO {
  id: string;
  name: string;
  family: string;
  // Venue scoping (B11): the only market venue this robot evaluates.
  venue: string;
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
  market?: { question: string; venue: string };
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
  // A-08 front-end depth: trigger + the exact strategy version that decided.
  trigger?: string | null;
  strategyVersionId?: string | null;
  // Phase 5 (A-02): the producing model + provenance envelope.
  modelKey?: string | null;
  provenance?: string | null;
  createdAt: string;
  robot?: { name: string };
  market?: { question: string; venue: string };
}

export interface PositionRowDTO {
  id: string;
  side: string;
  sizeCents: number;
  avgPriceCents: number;
  openedAt: string;
  status: string;
  // Mark-to-market on the venue's last synced price — same math as the risk
  // engine. null when the venue price feed has no quote for this side yet.
  unrealizedCents: number | null;
  market?: { question: string; venue: string; yesPriceCents: number | null; noPriceCents: number | null; eventKey?: string | null };
  robot?: { name: string };
}

// Per-venue rollup for the dashboard venue grid (B9/B11). Driven by the
// registry — every venue in the lineup always appears, even with zero data.
export interface VenueStatDTO {
  venue: string;
  markets: number;
  robotsTotal: number;
  robotsActive: number;
  openPositions: number;
  exposureCents: number;
  unrealizedCents: number;
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
  openAlerts: number;
  venues: VenueStatDTO[];
  robots: RobotDTO[];
  orders: OrderRowDTO[];
  positions: PositionRowDTO[];
  traces: TraceDTO[];
  notifications: Array<{ id: string; severity: string; family: string; title: string; body: string; createdAt: string }>;
  marketCount: number;
  outboxPending: number;
  providers: ProviderDTO[];
  risk: Array<{ scope: string; key: string; valueNum: number }>;
  control?: ControlStateDTO;
}

export interface MarketDTO {
  id: string;
  venue: string;
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
  // Phase 4 — structural thin-liquidity data (S-05) + A-04 cluster key.
  yesTouchDepthCents: number | null;
  noTouchDepthCents: number | null;
  yesTakerFeeBps: number | null;
  noTakerFeeBps: number | null;
  eventKey: string | null;
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

// Phase 2 — C5 strategy versioning
export interface StrategyConfigDTO {
  entryRule: string;
  minEdgePts: number;
  estimatorTiltPct: number;
  exitEdgePts: number;
  holdTicksMax: number;
  exitPolicy: string;
  schedule: string;
  estimator: string;
}

export interface VersionDTO {
  id: string;
  version: number;
  config: StrategyConfigDTO;
  orderCount: number;
  isActive: boolean;
  createdAt: string;
}

// Phase 2 — A-05 backtests
export interface BacktestStatsDTO {
  trades: number;
  wins: number;
  winRatePct: number;
  pnlCents: number;
  feesCents: number;
  roiPct: number;
  maxDrawdownPct: number;
  avgEdgeAtEntry: number;
  avgHoldTicks: number;
  skippedForLiquidity: number;
  openAtEnd: boolean;
}

export interface CurvePoint {
  i: number;
  t: string;
  equityCents: number;
}

export interface BacktestTradeDTO {
  side: string;
  entryIdx: number;
  exitIdx: number;
  entryCents: number;
  exitCents: number;
  edgeAtEntry: number;
  holdTicks: number;
  feeCents: number;
  pnlCents: number;
}

export interface BacktestResultDTO {
  ok: boolean;
  runId?: string;
  params?: { slippageCents: number; feeBps: number; perTradeCents: number; minEdgePts: number; holdTicksMax: number; simCapitalCents: number };
  stats?: BacktestStatsDTO;
  curve?: CurvePoint[];
  trades?: BacktestTradeDTO[];
  dataSource?: string;
  ticks?: number;
  marketQuestion?: string;
  robotName?: string;
  version?: number;
  error?: string;
}

export interface NotifyStatusDTO {
  resendConfigured: boolean;
  from: string | null;
  last24h: { sent: number; failed: number; noKey: number };
  note: string;
}

// Phase 5 — A-01 model registry / A-03 baseline / A-07 governance / B10 gate
export interface CalibrationDTO {
  n: number;
  nLive: number;
  nSynthetic: number;
  brier: number;
  logLoss: number;
  baselineBrier: number;
  deltaPct: number;
  eligible: boolean;
  demote: boolean;
  computedAt: string;
  window: string;
}

export interface ModelRowDTO {
  key: string;
  kind: string;
  providerName: string | null;
  providerModel: string | null;
  status: string;
  notes: string | null;
  calibration: CalibrationDTO | null;
  promotedAt: string | null;
  demotedAt: string | null;
}

export interface BaselineDTO {
  key: string;
  version: number;
  formula: string;
  tiltPct: number;
  kind: string;
  recordedIn: string;
}

export interface ModelKnobsDTO {
  minSamples: number;
  promotionMarginPct: number;
  demotionTolerancePct: number;
}

export interface ProviderGovernanceDTO {
  name: string;
  enabled: boolean;
  spentCents: number;
  monthlyBudgetCents: number;
  budgetUsedPct: number;
  calls24h: number;
  blocked24h: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface GovernanceDTO {
  providers: ProviderGovernanceDTO[];
  cache: { entries: number; hits24h: number; misses24h: number; hitRatePct: number };
  totals24h: { calls: number; blocked: number; failed: number };
}

export interface EdgeGateCheckDTO {
  check: string;
  passed: boolean;
  detail: string;
}

export interface EdgeGateDTO {
  robotId: string;
  ready: boolean;
  checks: EdgeGateCheckDTO[];
  generatedAt: string;
}

export interface ProbabilityDTO {
  baseline: BaselineDTO;
  knobs: ModelKnobsDTO;
  models: ModelRowDTO[];
  governance: GovernanceDTO;
  edgeGate?: EdgeGateDTO | null;
}

// Phase 3 — platform control plane (C19/S-07 pause, P3.2 autopilot)
export interface PauseStateDTO {
  paused: boolean;
  reason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
}

export interface AutopilotLastRunDTO {
  at: string;
  cycles: number;
  trades: number;
  noTrades: number;
  errors: number;
  reconciled?: number;
  skipped?: string;
}

export interface AutopilotStateDTO {
  enabled: boolean;
  intervalSec: number;
  startedAt: string | null;
  lastRun: AutopilotLastRunDTO | null;
}

export interface ControlStateDTO {
  pause: PauseStateDTO;
  autopilot: AutopilotStateDTO;
}

export const FAMILIES = [
  { id: "PROBABILITY_EDGE", label: "Probability Edge", desc: "Enter when model-vs-market edge exceeds a threshold, net of fees." },
  { id: "MARKET_MAKING", label: "Market-Making", desc: "Quote both sides around a fair value; earn the spread and maker rebates." },
  { id: "AI_RESEARCH", label: "AI Research", desc: "LLM-driven evidence gathering with sourced citations; trades only after the edge gate." },
  { id: "ARBITRAGE", label: "Arbitrage (planned)", desc: "YES+NO parity and clustered offsets — deterministic edge, later phase." },
] as const;

// P-03 — Robot template as served by GET /api/robot-templates (venue status
// annotated). Mirrors src/lib/robotTemplates.ts RobotTemplate.
export interface TemplateDTO {
  id: string;
  label: string;
  family: string;
  riskProfile: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  thesis: string;
  behavior: string;
  venue: string;
  venueLabel: string;
  venueLive: boolean;
  venueWhy: string;
  nameSuggestion: string;
  capital: {
    allocatedCents: number;
    maxPositionCents: number;
    maxOpenPositions: number;
    dailyLossStopPct: number;
    drawdownStopPct: number;
  };
  strategy: {
    entryRule: string;
    minEdgePts: number;
    estimatorTiltPct: number;
    exitEdgePts: number;
    holdTicksMax: number;
    estimator: string;
  };
  guidedPath: string[];
}

export const FAMILY_LABEL: Record<string, string> = Object.fromEntries(
  FAMILIES.map((f) => [f.id, f.label]),
);

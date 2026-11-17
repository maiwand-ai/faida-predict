// P-03 — Robot templates: curated, versioned starting points per ratified
// family (B6). A template is a complete, honest configuration — venue, family,
// capital, risk stops and the strategy knobs the engine actually consumes
// (minEdgePts, estimatorTiltPct, exitEdgePts, holdTicksMax — see
// src/lib/strategy.ts normalizeConfig and src/lib/engine/cycle.ts). Templates
// are code constants so they version with the repo; they never promise
// performance (A-05/D-03) — each one still has to earn its own evidence.
export interface RobotTemplateCapital {
  allocatedCents: number;
  maxPositionCents: number;
  maxOpenPositions: number;
  dailyLossStopPct: number;
  drawdownStopPct: number;
}

export interface RobotTemplate {
  id: string;
  label: string;
  family: string; // B6 family id — PROBABILITY_EDGE | MARKET_MAKING | AI_RESEARCH
  riskProfile: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  thesis: string; // why this template exists, one honest sentence
  behavior: string; // what the robot will actually do cycle after cycle
  venue: string; // recommended venue — must be LIVE in src/lib/venues.ts
  venueWhy: string;
  nameSuggestion: string;
  capital: RobotTemplateCapital;
  strategy: {
    entryRule: string;
    minEdgePts: number;
    estimatorTiltPct: number;
    exitEdgePts: number;
    holdTicksMax: number;
    estimator: string;
  };
  guidedPath: string[]; // the one-session path: template → first backtest
}

export const ROBOT_TEMPLATES: RobotTemplate[] = [
  {
    id: "contrarian-fade",
    label: "Contrarian Fade",
    family: "PROBABILITY_EDGE",
    riskProfile: "CONSERVATIVE",
    thesis:
      "Prices overshoot; the A-03 baseline personality — fading extreme prices toward 50 — is the platform's calibration floor, so start where the math is known.",
    behavior:
      "Each cycle it fades book prices ≥8 pts away from its contrarian estimate, net of fees; exits when the edge disappears or after 12 ticks.",
    venue: "POLYMARKET",
    venueWhy: "Deepest books on the lineup — the fade needs real opposing liquidity to fill against (B2).",
    nameSuggestion: "Contrarian Fade 01",
    capital: {
      allocatedCents: 200000,
      maxPositionCents: 20000,
      maxOpenPositions: 4,
      dailyLossStopPct: 5,
      drawdownStopPct: 10,
    },
    strategy: {
      entryRule: "edge>=8pts net of fees",
      minEdgePts: 8,
      estimatorTiltPct: 25,
      exitEdgePts: 2,
      holdTicksMax: 12,
      estimator: "HEURISTIC",
    },
    guidedPath: [
      "Create the robot — everything prefilled",
      "Run a first cycle and read the trace",
      "Run the first backtest (A-05 evidence)",
      "Review results in the Strategy lab below",
    ],
  },
  {
    id: "high-edge-sniper",
    label: "High-Edge Sniper",
    family: "PROBABILITY_EDGE",
    riskProfile: "AGGRESSIVE",
    thesis:
      "Trade rarely and only on large dislocations — wide margin, fewer decisions, each one worth the fees.",
    behavior:
      "Waits for ≥14 pts of model-vs-market edge (harder fade tilt 35), enters up to 3 positions, exits fast when the dislocation closes or after 8 ticks.",
    venue: "POLYMARKET",
    venueWhy: "Primary venue depth concentrates the dislocations this template hunts (B2).",
    nameSuggestion: "Sniper 01",
    capital: {
      allocatedCents: 100000,
      maxPositionCents: 15000,
      maxOpenPositions: 3,
      dailyLossStopPct: 4,
      drawdownStopPct: 8,
    },
    strategy: {
      entryRule: "edge>=14pts net of fees",
      minEdgePts: 14,
      estimatorTiltPct: 35,
      exitEdgePts: 3,
      holdTicksMax: 8,
      estimator: "HEURISTIC",
    },
    guidedPath: [
      "Create the robot — everything prefilled",
      "Run a first cycle and read the trace",
      "Run the first backtest (A-05 evidence)",
      "Review results in the Strategy lab below",
    ],
  },
  {
    id: "spread-harvester",
    label: "Spread Harvester (paper MM)",
    family: "MARKET_MAKING",
    riskProfile: "BALANCED",
    thesis:
      "Market-making posture in paper mode: small caps, many small positions, quick exits — the shape of quoting both sides without live quotes yet.",
    behavior:
      "Runs a light fade (tilt 10) with a low 5-pt entry bar, up to 6 tiny positions, exits when the edge narrows below 1 pt or after 20 ticks.",
    venue: "POLYMARKET",
    venueWhy: "MM earns the spread where books are deepest; Polymarket is the only book deep enough to practice on (B2).",
    nameSuggestion: "Spread Harvester 01",
    capital: {
      allocatedCents: 300000,
      maxPositionCents: 10000,
      maxOpenPositions: 6,
      dailyLossStopPct: 4,
      drawdownStopPct: 8,
    },
    strategy: {
      entryRule: "edge>=5pts net of fees, MM posture",
      minEdgePts: 5,
      estimatorTiltPct: 10,
      exitEdgePts: 1,
      holdTicksMax: 20,
      estimator: "HEURISTIC",
    },
    guidedPath: [
      "Create the robot — everything prefilled",
      "Run a first cycle and read the trace",
      "Run the first backtest (A-05 evidence)",
      "Review results in the Strategy lab below",
    ],
  },
  {
    id: "ai-scout",
    label: "AI Scout",
    family: "AI_RESEARCH",
    riskProfile: "BALANCED",
    thesis:
      "Let the registered AI model drive estimates while its calibration evidence accrues — on play money, where wrong turns cost nothing.",
    behavior:
      "Uses the estimator chain (ACTIVE registry model → screening → cache → fallback), enters at ≥10 pts net edge, exits at 2 pts or after 10 ticks.",
    venue: "MANIFOLD",
    venueWhy: "Play-money harness: AI costs and calibration get proven where mistakes are free (B9).",
    nameSuggestion: "AI Scout 01",
    capital: {
      allocatedCents: 150000,
      maxPositionCents: 15000,
      maxOpenPositions: 3,
      dailyLossStopPct: 5,
      drawdownStopPct: 10,
    },
    strategy: {
      entryRule: "edge>=10pts net of fees, AI-led",
      minEdgePts: 10,
      estimatorTiltPct: 25,
      exitEdgePts: 2,
      holdTicksMax: 10,
      estimator: "AI_OR_HEURISTIC",
    },
    guidedPath: [
      "Create the robot — everything prefilled",
      "Run a first cycle and read the trace",
      "Run the first backtest (A-05 evidence)",
      "Review results in the Strategy lab below",
    ],
  },
];

export function getTemplate(id: string): RobotTemplate | null {
  return ROBOT_TEMPLATES.find((t) => t.id === id) ?? null;
}

// Build the wizard payload exactly as the manual path would — one code path,
// so a template robot and a hand-configured robot are indistinguishable downstream.
export function templateToCreatePayload(t: RobotTemplate, name: string) {
  return {
    name: name.slice(0, 60),
    family: t.family,
    venue: t.venue,
    allocatedCents: t.capital.allocatedCents,
    maxPositionCents: t.capital.maxPositionCents,
    maxOpenPositions: t.capital.maxOpenPositions,
    dailyLossStopPct: t.capital.dailyLossStopPct,
    drawdownStopPct: t.capital.drawdownStopPct,
    config: {
      family: t.family,
      ...t.strategy,
      exitPolicy: "edge_disappears_or_adverse_verified_info",
      schedule: "continuous",
    },
  };
}

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
      "Crowds overreact. When a price swings to an extreme, this robot bets it drifts back toward the middle. The simplest, best-understood strategy to start with.",
    behavior:
      "Enters only when the price is at least 8 points off its own estimate after fees. Leaves when that gap closes, or after 12 checks at the latest.",
    venue: "POLYMARKET",
    venueWhy: "Polymarket has the deepest order books, so this robot's bets can actually be filled.",
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
      "Test it on past prices",
      "Review results in the Strategy lab below",
    ],
  },
  {
    id: "high-edge-sniper",
    label: "High-Edge Sniper",
    family: "PROBABILITY_EDGE",
    riskProfile: "AGGRESSIVE",
    thesis:
      "Trades rarely, and only when a price is badly wrong. Fewer trades, but each one has a wide margin to cover fees.",
    behavior:
      "Waits for a gap of 14 points or more, holds at most 3 trades, and gets out fast once the price corrects, or after 8 checks.",
    venue: "POLYMARKET",
    venueWhy: "The big price swings this robot looks for show up most on Polymarket, the deepest market.",
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
      "Test it on past prices",
      "Review results in the Strategy lab below",
    ],
  },
  {
    id: "spread-harvester",
    label: "Spread Harvester (paper MM)",
    family: "MARKET_MAKING",
    riskProfile: "BALANCED",
    thesis:
      "Many small, quick trades instead of a few big ones, so no single trade matters much.",
    behavior:
      "Enters on small 5-point gaps, holds up to 6 tiny trades, and exits as soon as the gap is under 1 point, or after 20 checks.",
    venue: "POLYMARKET",
    venueWhy: "Many small trades need deep order books, and Polymarket has the deepest.",
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
      "Test it on past prices",
      "Review results in the Strategy lab below",
    ],
  },
  {
    id: "ai-scout",
    label: "AI Scout",
    family: "AI_RESEARCH",
    riskProfile: "BALANCED",
    thesis:
      "Lets the AI make the price estimates, on play money where mistakes cost nothing, while it builds a track record.",
    behavior:
      "Uses your approved AI model (or a simple fallback if none is set up). Enters on a 10-point gap after fees, exits at 2 points or after 10 checks.",
    venue: "MANIFOLD",
    venueWhy: "Manifold is play money, so the AI builds its track record where mistakes cost nothing.",
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
      "Test it on past prices",
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

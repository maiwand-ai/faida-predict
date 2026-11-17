# FAIDA Predict — Decision Register (DECISIONS.md)

Founder decisions recorded 2026-11-16. This file is the product-level source of
truth for choices that must not drift; code reads them via config, not folklore.

| # | Decision | Choice | Status | Notes |
|---|----------|--------|--------|-------|
| B1 | Custody model | **SELF-CUSTODY** — each user's wallet signs every order (EIP-712); platform never holds keys | RATIFIED | `Wallet.signingModel` is a schema invariant; live signing lands in Phase 7 |
| B2 | Launch venue | **Polymarket only** (adapter architecture ready for Limitless / Manifold harness / Kalshi later) | RATIFIED | Compliance catalog: S-05 rows in `src/lib/venue/types.ts` |
| B3 | Jurisdiction | **Editable eligibility matrix** — EU-first allow set; venue-restricted and sanctioned lists blocked; default-deny unknown countries | RATIFIED | `EligibilityRule` table + Settings UI; [VERIFY] rows need counsel sign-off pre-launch |
| B4 | Pricing | Free / Pro / Professional with AI-credit allowances — to be drafted by engineering, approved by founder **before billing is wired** | PENDING (P-05) | No billing code exists yet; nothing charges anyone |
| B5 | Risk defaults | Two-tier: platform ceilings (daily loss 20%, drawdown 30%, per-event 50%, AI budget $200/mo) + user defaults (5% / 10% / 40% / $100/mo). Users may only be stricter. Fully editable in-app | RATIFIED | `RiskConfig` table + `src/lib/risk.ts`; changes audited |
| B6 | Robot families at launch | Probability Edge, Market-Making, AI Research (Arbitrage/Parity planned as family #4) | RATIFIED | Skeleton ships all three as paper robots |
| B7 | AI strategy | **Provider-agnostic gateway**: any provider key (GLM keyless in sandbox, OpenAI, Anthropic, OpenAI-compatible base URL) makes the research engine work; deterministic heuristic fallback when none configured | RATIFIED | `AiProvider` table + `src/lib/ai/gateway.ts`; keys masked, never returned |
| B8 | Venue automation | Robots execute autonomously post-activation; humans own activation, emergency pause, and resume-from-risk states | CONFIRMED (spec premise) | Skeleton refuses `RUNNING` (live) until Phase 7 gates — enforced in API |
| B9 | Venue lineup | **Polymarket = primary** (CLOB REST + WebSocket, USDC on Polygon, API-only — where robots earn). **Manifold = free harness wired in from week one** (play money, public API, zero-risk environment pre-edge-gate; Polymarket-shaped enough to exercise the whole pipeline). **Limitless = fast-follow** (crypto-native order book on Base; thin liquidity handled structurally — min-depth + edge-after-fees). **Drift BET (Solana) + Azuro (EVM, sports) = fast-follow SDK adapters**. **Kalshi = fast-follow** (CFTC-regulated US DCM, REST + key auth — the US-persons complement where Polymarket is venue-restricted; re-added per founder) | RATIFIED | Lineup + roles encoded in `src/lib/venues.ts`; per-venue UI sections per B11; adapters land venue-by-venue. Ratified `f5352d9`, Kalshi amendment `bbf2574`. The per-venue adapter contracts and integration order are pinned in `docs/DEVELOPMENT_PLAN.md` §3 |
| B10 | Live money gates | Edge gate + backtest (A-05 fill-model) + paper session + recorded consent (C25) before any live order | RATIFIED | `placeOrder()` on the live adapter throws by contract |
| B11 | Venue visibility & scoping | Every robot is scoped to exactly one venue; the UI states the venue on every market, order, robot card, trace and ticket. Venues without a live adapter are visible but marked "adapter pending" and refused at robot creation (422) | RATIFIED | `src/lib/venues.ts` registry; `Robot.venue` column; cycle engine selects markets by `robot.venue`; wizard step 1 = venue picker |
| B12 | Venue color identity | Each venue carries a distinct accent color — Polymarket `#3E8EFF`, Manifold `#14D9C4`, Limitless `#F26BC8`, Drift BET `#C6F542`, Azuro `#B18CFF`, Kalshi `#FFB25C` — used on the dashboard venue cards, the venue workspace interior (header glow/strip, primary CTA, section dots), venue badges, market sections, the studio venue picker and the trade ticket. Pending venues render their hue muted toward slate until the adapter ships. Role chips are neutral gray so the venue hue carries identity. Colors are FAIDA-internal identity, not venue brand marks | RATIFIED | `VenueDef.hex` + `VENUE_COLOR`/`venueColor` in `src/lib/venues.ts`; `vc-*` utility layer in `src/app/globals.css` (CSS var `--vc` + color-mix); applied in dashboard.tsx, app.tsx, views.tsx. Requested by the founder before Phase 4 (2026-11-16) |
| A-03 | Baseline estimator | **heuristic-contrarian-v1**: `est = clamp(p + round((50 − p) × tilt / 100), 2, 98)`, tilt 25 — the deterministic contrarian fade of the YES book toward 50%. It is the calibration floor every registered model must beat (Brier, ≥30 resolved forecasts, 5% margin) and the fallback the platform always returns to. Baseline Brier is derived analytically from the recorded book price, so comparisons can never cherry-pick their sample | RATIFIED | `src/lib/probability/baseline.ts` + `MODEL_BASELINE` in PlatformControl; recorded with Phase 5 (2026-11-17) |
| A-01 | Model governance | Unproven models never drive decisions: a candidate estimates nothing until the founder promotes it on calibration evidence (B8); an ACTIVE model that drifts worse than baseline by >5% over its recent window is demoted automatically and the baseline re-activates. Every promote/demote writes a MODEL_GOVERNANCE notification + MODEL outbox event. Drills must pass before a phase that touches models closes | RATIFIED | `ProbabilityModel` table + `src/lib/probability/registry.ts`; demotion drill `scripts/demotion_drill.py` |
| A-06 | Evidence integrity | Market text is untrusted: every forecast input passes prompt-injection screening before any AI prompt, and flagged evidence fails closed to the baseline with the FLAGGED verdict recorded in the trace provenance. Every estimate carries an evidence hash binding it to its exact inputs | RATIFIED | `src/lib/probability/screening.ts`; traces carry `provenance` (A-02) since Phase 5 |

## Phase-5 checkpoint status (probability & AI layer hardening)

- Phase 5 scope — **locked and implemented** (2026-11-17): A-03 baseline
  recorded as a decision (see A-03 row); A-01 model registry live with
  calibration/promotion/demotion (demotion drill PASS — promotion round trip,
  corrupted-window demotion, audit trail, baseline fallback re-verified);
  A-02 provenance on every new trace (model key, evidence hash, screening,
  cache, latency, fallback); A-06 injection screening fail-closed (injected
  market text produced a FLAGGED trace estimated by the baseline);
  A-07 governance (call log, cache with 6 h TTL, budget-blocked outcomes
  logged, p50/p95 + hit-rate card); B10 edge gate now aggregates six real
  evidence checks per robot and stays `ready=false` by contract.
- Estimator chain — **one path, no side doors**: ACTIVE registry model →
  screening → cache → AI gateway → baseline fallback; unproven candidates
  never estimate for robots regardless of provider state (the pre-Phase-5
  behavior of "any enabled key drives estimates" is retired).
- Acceptance evidence in `docs/DEVELOPMENT_PLAN.md` §4 (Phase 5):
  `scripts/demotion_drill.py` DRILL PASS, `scripts/smoke_phase5.py` SMOKE
  PASS (28 checks), tsc + lint clean, screenshot pass over the Settings
  registry/governance cards and dashboard traces.
- Live trading — **still disabled by contract** (Phase 7 gates + explicit
  authorization).

## Phase-4 checkpoint status (venue #3 Limitless, exposure intelligence)

- Phase 4 scope — **locked and implemented** (2026-11-17): Limitless adapter
  LIVE (30 markets synced with per-side touch depth + taker fee bps captured
  at sync; Polymarket/Manifold syncs unchanged), structural thin-liquidity
  rules armed from `src/lib/venue/rules.ts` (min-touch-depth refusal with the
  measured depth stated and fail-closed missing books, edge-after-fees with
  the fee charged on paper fills, $500 per-market cap user-wide), A-04 event
  clustering stacking related-market exposure in the per-event check.
  Acceptance evidence in `docs/DEVELOPMENT_PLAN.md` §4 (thin book refused
  422 with stated depth; liquid book filled with fee; Fed cluster stacked to
  the exact 20000¢ cap before the 5th order was refused with the full sum).
- S-05 conformance — **fixture-recorded and green**: `tests/fixtures/limitless`
  committed with a provenance manifest (`recorded.json`); `bun run conformance`
  replays the adapter offline — 33/33 PASS on 2026-11-17 (liquid book 26600¢
  touch vs thin book 151¢). The recording script is committed next to the
  fixtures; re-record after material fee-regime or API changes.
- Founder-calibrated structural thresholds — **min touch depth $50
  (5000¢), per-market position cap $500 (50000¢)**, recorded 2026-11-17 in
  `src/lib/venue/rules.ts` and measured against live Limitless books (daily
  BTC book trades, hourly BTC books refuse). Config, not code — recalibrate
  by editing the rules module only.
- Live trading — **still disabled by contract** (Phase 7 gates + explicit
  authorization).

## Phase-3 checkpoint status (autonomy, Manifold harness, safety layer)

- Venue lineup B9 — **ratified with the founder** (six venues; Polymarket
  primary, Manifold week-one harness, Limitless/Drift BET/Azuro fast-follow,
  Kalshi US complement). Per-venue adapter contracts pinned in
  `docs/DEVELOPMENT_PLAN.md` §3 — that file is the development-time source of
  truth; nothing from the lineup may be dropped during implementation.
- Phase 3 scope — **locked and implemented** (2026-11-16): Manifold adapter
  LIVE (30 markets synced, full paper pipeline traded), autopilot with
  per-robot loop leases (parallel-tick refusal verified), global pause with
  measured propagation on cycles AND manual orders, pre-trade staleness gate
  with measured age in traces, soak runner (smoke PASS — full 72 h owed on
  founder host). Acceptance evidence in `docs/DEVELOPMENT_PLAN.md` §4.

## Phase-2 checkpoint status (strategy lab, R-03 continued)

- Strategy versioning C5 — **working: immutable versions, activate = pointer move, orders record exact version**
- Backtest engine A-05 — **working: deterministic replay, adverse slippage + fees + liquidity guard, SYNTHETIC/LIVE honesty badge**
- Price recorder — **working: ticks appended on every market sync and robot cycle; seed writes labeled SYNTHETIC history**
- Outbox email fan-out F8 — **working: Resend best-effort per event, throttled, per-event emailStatus, honest NO_KEY state**
- Live trading — **still disabled by contract** (Phase 7 gates + explicit authorization)

## Phase-1 checkpoint status (walking skeleton, R-03)

- Order state machine S-01 with UNKNOWN → reconciliation-only resolution — **working, journal-per-transition**
- Transactional outbox S-02 — **working, drained to notifications**
- Idempotency S-03 — **verified: same nonce returns the original order**
- Paper ledger P-02 — **working, balances append-only**
- Risk engine C10 (balance, position cap, open positions, per-event exposure, mark-to-market daily loss) — **verified refusing over-cap orders**
- Eligibility C4.5 — **verified: sanctioned jurisdictions refuse to flip**
- Live Polymarket market data — **30 markets synced via Gamma adapter (read-only)**
- AI gateway A-06 — **GLM keyless path verified; OpenAI/Anthropic/compatible slots ready**
- Live trading — **disabled by contract** (Phase 7 gates + explicit authorization)

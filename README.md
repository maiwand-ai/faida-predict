# FAIDA Predict — Phase 6 (Robot Studio completion · templates · trace depth · Drift verdict)

Autonomous prediction-market trading platform — paper-mode core with the full
trust architecture from the specification review brief. **All execution is
paper; live trading is disabled by contract until the Phase 7 gates pass.**

Planning source of truth: `docs/DEVELOPMENT_PLAN.md` (venue contracts, phase
ledger, carry-forward register). Decisions: `DECISIONS.md`.

## What is working

- **Robot templates (P-03, Phase 6)** — four launch-family templates with full
  payloads (capital, risk stops, C5 knobs, venue, guided path) served via
  `GET /api/robot-templates`; the Studio gallery + review term sheet prove
  provenance, and a robot built from a template is verified to match it in
  the DB (Robot row + immutable StrategyVersion v1).
- **Guided session (Phase 6)** — template → first backtest in one run:
  three numbered steps wired to real cycle summaries and a venue-scoped (B11)
  first backtest that prefers markets with ≥20 recorded ticks.
- **Trace depth UI (A-08, Phase 6)** — every decision trace expands in place
  (dashboard + venue workspaces) to the full provenance envelope and each
  pre-trade risk check with its measured detail; collapsed to the glanceable
  verdict by default.
- **Visual regression (Phase 6)** — `scripts/visual-regression.ts` (pixel +
  DOM modes) wired into the phase smoke so a UI break fails acceptance.
- **Usability walkthrough (Phase 6)** — three-persona scripted proxy with a
  findings register (F1/F2 fixed in-phase) in `docs/USABILITY_PHASE6.md`; the
  real three-user check stays owed on the founder host.
- **Drift BET verdict (Phase 6, venue #4)** — adapter deliberately NOT built:
  the venue is offline since the April 2026 exploit and cannot pass S-05
  conformance; compliance row `SUSPENDED` with dated [VERIFY] evidence,
  DRIFT_BET robot creation refused 422. Slot #4 substitution awaits the
  founder's verdict (B9) — promote Azuro, substitute, or hold for relaunch.
- **Model registry (A-01, Phase 5)** — every estimator is a registry row
  (`ProbabilityModel`): the baseline heuristic is the floor (A-03), AI models
  accumulate calibration evidence as CANDIDATES and only the founder can
  promote one (B8) once it beats the baseline by the margin over ≥30 resolved
  forecasts; an ACTIVE model drifting worse than baseline by >5% over its
  recent window is demoted automatically and the baseline re-activates, with
  a MODEL_GOVERNANCE notification + MODEL outbox event. Demotion drill:
  `bun run drill` (DRILL PASS 2026-11-17).
- **Baseline definition (A-03, Phase 5)** — `heuristic-contrarian-v1`:
  `est = clamp(p + round((50 − p) × tilt / 100), 2, 98)`, tilt 25, recorded
  in DECISIONS.md and PlatformControl; baseline Brier on any sample is
  derived analytically so comparisons can never cherry-pick their sample.
- **Forecast provenance (A-02, Phase 5)** — every trace records `modelKey`
  plus the provenance envelope: evidence hash (sha256 of market/venue/
  question/book state), screening verdict, cache state, latency, estimator
  version, and an honest `fallbackFrom` on fallbacks. Traces wear a model
  chip (BL / AI:<PROVIDER> · cache-HIT · screening flag).
- **Evidence integrity + prompt-injection screening (A-06, Phase 5)** —
  market text is untrusted: instruction-override, role-impersonation,
  prompt-leak, output-steering and control-character patterns are screened
  before any AI prompt; flagged evidence fails closed to the baseline with
  the FLAGGED verdict in the trace.
- **AI cost & latency governance (A-07, Phase 5)** — every attempt logged
  (`AiCallLog`: latency, cost, OK/FAILED/BUDGET_BLOCKED); identical estimates
  served from the cache within the TTL free; budget-blocked providers logged
  and honestly fallen back; Settings card shows calls, p50/p95, hit rate and
  per-provider spend bars.
- **Edge gate evidence (B10, Phase 5)** — `GET /api/probability?robotId=…`
  aggregates the six live-activation checks (model calibrated, provenance
  completeness, evidence clean, backtest evidence, paper session, recorded
  consent) — real evidence now; the gate stays `ready=false` until Phase 7.
- **Order state machine (S-01)** — CREATED → VALIDATED → SUBMITTED → FILLED,
  with RECONCILING/UNKNOWN states that only reconciliation evidence can
  resolve. Every transition is journaled (`OrderEvent`).
- **Reconciliation (S-04)** — venue-aware evidence lookup (the adapter is
  chosen by the order's venue, never hardcoded), resolved orders close their
  open drift entries; the drill (lost venue ack → UNKNOWN → REJECTED) works
  end to end.
- **Transactional outbox (S-02)** — events written in the same transaction as
  state changes, drained to the notification feed **and paged by email via
  Resend** (best-effort, per-event `emailStatus`, throttled, honest NO_KEY state).
- **Idempotency keys (S-03)** — same economic input + nonce = same order, never
  a duplicate.
- **Strategy versioning (C5)** — versions are immutable; the lab saves new
  versions from sliders, activation is a pointer move, and every order/trace
  records the exact `strategyVersionId` that produced it.
- **Backtest engine (A-05)** — deterministic replay over recorded
  `MarketPriceTick` history with the conservative fill model: adverse
  slippage, fee schedule, 5%-of-liquidity guard; SYNTHETIC vs LIVE honesty
  badge (D-03).
- **Venue lineup (B9/B11)** — six-venue registry in `src/lib/venues.ts`
  (Polymarket primary · Manifold harness · Limitless live · Drift BET
  **SUSPENDED since Phase 6** — adapter deliberately not built · Azuro /
  Kalshi fast-follows); robots are scoped to exactly one venue; every market,
  order, robot card, trace and ticket names its venue; wizard step 1 is a
  venue picker that only allows live adapters.
- **Polymarket adapter (LIVE market data)** — Gamma API, public, read-only,
  BigInt-safe.
- **Manifold adapter (LIVE market data, Phase 3)** — play-money harness via
  public REST; binary markets only; the full pipeline (sync → decision →
  paper fill → ledger → trace) runs on it with zero financial risk.
- **Limitless adapter (LIVE market data, Phase 4)** — Base-network CLOB via
  public REST (`/markets/active` + `/markets/{slug}/orderbook`, books
  best-effort, fail-closed on gaps); touch depth (USDC notional at the
  touch) and per-side taker fee bps are captured **at sync** and stored on
  the market; A-04 event keys from groupId/eventId.
- **Structural thin-liquidity rules (Phase 4, S-05/B9)** — `src/lib/venue/rules.ts`
  declares the venue's entry rules as config; the shared risk engine applies
  them to robots AND manual tickets: (a) min-touch-depth refusal with the
  measured depth stated in the refusal and fail-closed when no book was
  captured; (b) edge computed **after** venue taker fees (documented
  regimes: AMM flat 0.40%, CLOB COLLATERAL 5%×(1−p), legacy buy curve
  3.00%→0.40%) and the fee charged on paper fills; (c) per-market position
  cap, user-wide across all robots.
- **Event clustering A-04 (Phase 4)** — markets sharing an `eventKey` have
  their open exposure **summed** in the per-event exposure check; the
  refusal states the stacked sum and the markets in the cluster. Dashboard
  positions carry CLUSTER chips; the portfolio-risk card shows cluster
  exposure.
- **S-05 conformance (Phase 4)** — `bun run conformance` replays the
  Limitless adapter against recorded fixtures (`tests/fixtures/limitless`,
  provenance in `recorded.json`): mapping, parity, depth derivation, fee
  regimes, fee drag, rules arming, refuse/allow verdicts, live-write block.
  Re-record with `bun scripts/record-fixtures-limitless.ts`.
- **Autopilot (P3.2)** — interval-driven cycles + reconciliation passes
  without manual clicks; state persisted, timer self-heals after restart;
  humans own start/stop (B8).
- **Robot loop leases (S-06)** — one active cycle per robot, ever; a retried
  tick or a second worker is refused while the lease is live; expiry allows
  takeover after a crash.
- **Global pause / kill switch (C19/S-07)** — every cycle and every order
  path checks it first; propagation is measured (refused ticks record the
  time since the pause decision); CRITICAL notification; red banner in the UI.
- **Pre-trade staleness gate (S-10)** — robots refuse to decide on market
  data older than the configured freshness threshold (default 15 min for
  sync-fed paper; the B5 5-second book budget applies with the live book
  adapter in Phase 7). Age is measured and recorded in the trace.
- **Paper soak runner (P3.5)** — `scripts/soak.ts` drives cycles for a
  configurable duration and writes a verdict report: trace completeness,
  unresolved drift entries, UNKNOWN orders. Smoke variant passes; the full
  72-hour soak runs on the founder's host.
- **Paper trading engine (P-02)** — append-only virtual ledger, positions
  with average cost, fee schedule from config; venue taker fees charged on
  fills so paper P/L matches a live taker.
- **Risk engine (C10/B5)** — two-tier config (platform ceilings + user
  limits, stricter-only), per-event exposure (A-04 cluster-stacked),
  mark-to-market daily loss stop; venue structural rules (touch depth,
  per-market cap) arm per venue.
- **Eligibility matrix (C4.5)** — editable per-country allow/block with a hard
  sanction-list invariant; default-deny for unknown countries.
- **AI gateway (A-06)** — provider-agnostic: GLM (keyless via SDK), OpenAI,
  Anthropic, any OpenAI-compatible base URL. One estimator chain since
  Phase 5: ACTIVE registry model → screening → cache → gateway → baseline
  fallback; unproven candidates never estimate for robots.
- **Decision traces (A-08)** — every robot decision, trade or no-trade, with
  model estimate, fee-adjusted net edge, all risk checks — config-driven per
  version, and since Phase 5 fully provenance-stamped (A-02).
- **UI** — venue-first dashboard cockpit: KPI band, in-trade table, venue
  grid (per-venue color identity, B12) → venue workspaces (robots, markets
  with the TOUCH depth column, positions, orders, traces with model chips);
  Robot Studio (wizard + **Strategy Lab**); Trading (ticket + orders + ledger
  + reconciliation drill); Settings (risk, AI providers, **model registry +
  calibration**, **AI governance**, dispatcher status, eligibility).

## Run locally

```bash
bun install
bun run db:push
bun prisma/seed.ts
bun run conformance   # S-05 Limitless contract test against recorded fixtures
bun run drill         # A-01 demotion drill (governance round trip)
bun run smoke:phase5  # Phase-5 acceptance smoke against a running instance
bun run dev           # http://localhost:3000
```

## Try the trust machinery

1. **Dashboard → Run robot cycle** — robots evaluate markets **on their own
   venue** and trade or refuse with stated reasons (stale data, touch depth,
   edge net of fees, risk).
2. **Dashboard → Platform control** — press **Start autopilot** (pick 60/120/
   300 s) and watch cycles run without clicks; **Global pause** refuses
   everything (cycles and manual tickets) until **Resume**.
3. **Markets → Sync Polymarket / Manifold / Limitless** — per-venue adapters
   pull live markets, append price ticks, and (Limitless) capture touch depth
   + taker fee bps for the structural gate.
4. **Limitless → Create robot → Run robot cycle** — the thin crypto books
   refuse entry with the measured depth stated ("LIMITLESS rule (a): YES
   touch depth 677¢ vs minimum 5000¢") and liquid books trade with the
   taker fee charged on the paper fill.
5. **Trading → Simulate lost venue ack → UNKNOWN**, then **Run reconciliation
   pass** — the order resolves REJECTED with evidence, and the drift entry
   closes — never by hope.
6. **A-04 drill** — place manual orders across two markets of one Polymarket
   event (e.g. the Fed decision family): the per-event check stacks the
   cluster and the breach refusal states the full sum.
7. **Robot Studio → Strategy Lab** — save the sliders as an immutable v2,
   activate it, then **Run backtest**: stats, equity curve and the
   SYNTHETIC/LIVE honesty badge.
8. **Soak** — `bun scripts/soak.ts --duration-min 72 --interval-sec 60`
   against a running instance; the verdict lands in `soak-report.json`.
9. **Settings → Model registry** — **Recompute calibration**; watch a
   candidate become promotion-ready; **PROMOTE** an eligible model and see
   the baseline step down to the floor; run `bun run drill` to watch the
   full demotion round trip (promote → corrupted window → demoted → baseline
   back) with the audit trail in Recent activity.
10. **Settings → AI governance** — read calls 24 h, cache hit rate, GLM
   p50/p95 latency and the per-provider spend bars; **Clear estimate cache**.
11. **Settings** — flip an eligibility country (IR refuses); paste any LLM
   key; tighten a risk limit; read the dispatcher card.

## API surface (all JSON)

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/health` | GET | liveness + phase + mode |
| `/api/dashboard` | GET | aggregated overview (incl. control state) |
| `/api/markets` | GET, POST | cached list / venue-aware live sync (appends ticks) |
| `/api/robots` | GET, POST, PATCH | list, create (venue-validated, PAPER_ONLY), status transitions |
| `/api/strategies` | GET, POST, PATCH | version lineage, create immutable version, activate |
| `/api/backtests` | GET, POST | list/read runs, replay a version over ticks |
| `/api/orders` | GET, POST | list+ledger, place paper order, ack-loss drill |
| `/api/cycle` | POST | robot evaluation tick / reconciliation pass |
| `/api/control` | GET, POST | global pause, autopilot, staleness threshold |
| `/api/risk` | GET, PUT | effective two-tier risk, set user limit |
| `/api/settings/ai` | GET, PUT | masked providers, upsert key/config |
| `/api/settings/notify` | GET | dispatcher status (Resend env + 24h counts) |
| `/api/probability` | GET, POST | model registry + calibration + governance + edge gate; recompute/promote/demote/screen/cache actions |
| `/api/eligibility` | GET, PUT | matrix, flip country (sanctions locked) |

## Deploy (Vercel + Postgres)

The schema targets SQLite for the sandbox. For Vercel: swap the datasource
provider to `postgresql` in `prisma/schema.prisma`, set `DATABASE_URL`, run
`prisma db push` against the managed database, then `vercel deploy`.
Set `RESEND_API_KEY` (and optionally `NOTIFY_EMAIL_FROM`) to activate email
fan-out — without it the notification feed still works and the status card
says so. Stripe/Paddle (billing, pending B4) attaches at a new `/api/billing`
route. Note: the autopilot timer is process-local — on serverless it must be
replaced by a scheduled job hitting `/api/cycle` (self-host keeps the built-in
runner).

## Hard invariants (do not break)

1. Money is integer cents — floats never touch amounts (S-09).
2. UNKNOWN orders resolve only via reconciliation evidence (S-01/S-04).
3. Platform never stores wallet private keys (B1).
4. Sanctioned jurisdictions can never be allowed (C4.5).
5. Live order placement throws until Phase 7 gates + explicit authorization (B10).
6. Every order records the strategy version that produced it (C5) — versions
   are immutable; activation only moves the pointer, never the status.
7. Backtests are evidence, never promises: fills pay adverse slippage and
   fees, synthetic history is labeled SYNTHETIC (D-03/A-05).
8. Every robot, market, order, position and trace names its venue (B11).
9. Thin liquidity is structural, never an afterthought: venue entry rules
   live in `src/lib/venue/rules.ts` as config, the engine stays venue-blind,
   missing books fail closed (S-05/B9).
10. Unproven models never drive decisions — only the registry ACTIVE model
   estimates, promotion is a founder action, demotion restores the baseline,
   and every forecast carries provenance (A-01/A-02/A-03).

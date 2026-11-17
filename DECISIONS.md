# FAIDA Predict — Decision Register (DECISIONS.md)

Founder decisions recorded 2026-11-16. This file is the product-level source of
truth for choices that must not drift; code reads them via config, not folklore.

| # | Decision | Choice | Status | Notes |
|---|----------|--------|--------|-------|
| B1 | Custody model | **SELF-CUSTODY** — each user's wallet signs every order (EIP-712); platform never holds keys | RATIFIED | `Wallet.signingModel` is a schema invariant; live signing lands in Phase 7 |
| B2 | Launch venue | **Polymarket only** (adapter architecture ready for Limitless / Manifold harness / Kalshi later) | RATIFIED | Compliance catalog: S-05 rows in `src/lib/venue/types.ts` |
| B3 | Jurisdiction | **Editable eligibility matrix** — EU-first allow set; venue-restricted and sanctioned lists blocked; default-deny unknown countries | RATIFIED | `EligibilityRule` table + Settings UI; [VERIFY] rows need counsel sign-off pre-launch |
| B4 | Pricing | Free / Pro / Professional with AI-credit allowances — to be drafted by engineering, approved by founder **before billing is wired** | DRAFTED — AWAITING FOUNDER APPROVAL | Engineering draft recorded 2026-11-18 in `docs/PRICING_B4.md` (§7 approval checklist). **No billing code exists** (phase-smoke negative check) and none gets written until the founder approves AND the beta exit bar holds; P-01 organization schema waits with it |
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

## Phase-8 checkpoint status (commercial platform minus billing + Azuro)

- Phase 8 engineering scope — **locked, implemented and verified
  (2026-11-18, founder-directed)**: P-04 notification taxonomy + anti-storm
  (single writer, 7 families, honest suppressed-row accounting, read-time
  digest, CRITICAL never capped), P-06 data export + read-only API keys
  (plaintext shown once, SHA-256-only storage, Bearer public read API at
  `/api/public/v1/*`, 60 req/min honest 429, no write surface by design),
  P-07 compliance ops + retention (4 bounded policies, audited runs —
  financial truth NEVER pruned, asserted by the smoke), P-08 platform
  metrics (per-venue sync freshness for all six venues, outbox dispatch lag,
  honest nulls). Acceptance: `scripts/smoke_phase8.py` SMOKE PASS (P8-1..
  P8-8, 45 checks, isolation-run + re-run), smoke_phase4/phase5 regression
  re-runs PASS, tsc + lint clean, db:push additive (ApiKey + Notification
  anti-storm fields + RetentionRun), visual pass over the four new Settings
  cards; badge → 8.
- Azuro (venue #5) — **adapter IMPLEMENTED against the SDK-verified V3
  contract; venue stays PENDING (2026-11-18, recorded BEFORE adapter work
  per S-05 §3.2)**. Protocol alive (azuro.org, docs, @azuro-org/toolkit
  v7.2.0 npm 2026-10-10) — the official SDK dist types pin the REST contract
  the adapter implements (`api.onchainfeed.org/api/v1/public` market-manager;
  PolygonUSDT/BaseWETH environments; binary Active prematch conditions;
  margin-embedded fees; game-level A-04 clusters; close-time structural rule
  (d) armed in the shared risk engine). BUT every Azuro feed host returns
  origin-level 404 from the sandbox (api/dev-api/preprod/api.azuro.org,
  streams host; thegraph.onchainfeed.org does not resolve) while every other
  venue API answers from the same vantage — conformance fixtures cannot be
  recorded here. Drift precedent applied proportionately: compliance row
  VERIFY_BLOCKED with dated evidence, robot creation refused 422, **registry
  flip owed after `bun scripts/record-fixtures-azuro.ts` +
  `bun run conformance:azuro` pass from an unblocked vantage (founder host)**
  — no self-approved flip.
- B4 pricing — **drafted, NOT approved (2026-11-18)**: `docs/PRICING_B4.md`
  carries the engineering draft (Free €0 / Pro €19 / Professional €79 with
  AI-credit allowances, entitlement snapshots, hard-stop overage, 14-day
  dunning grace, refunds P-05, pluggable provider posture) and the founder
  approval checklist (§7). The BILLING family exists in the P-04 taxonomy as
  DORMANT — no code path emits it. **No billing code exists** (smoke P8-8c
  negative check) and none gets written until the founder approves AND the
  beta exit bar holds (BETA_PHASE75 §4).
- Live sends — **still held** (unchanged): the arm switch stays SAFE; the
  founder's explicit arm on the founder host remains the only path to a real
  send.

## Phase-7.5 checkpoint status (hardening + closed beta readiness)

- Phase 7.5 scope — **locked, implemented and verified (2026-11-18)**: six
  operational runbooks written AND drilled (`docs/RUNBOOKS.md` R1–R6,
  `scripts/drill_phase75.py` DRILL PASS 28 checks), C19.1 re-executed on the
  new cadence, chaos suite executed and reviewed (25 checks, all fail-closed),
  B5 load measured at target (500 robots, p95 699 ms ≤ 750 ms, availability
  100% at the protocol concurrency 16; honest 32-way lockstep stress recorded
  at p95 977 ms), closed-beta program locked (`docs/BETA_PHASE75.md`,
  10–25 cohort, weekly rounds, measurable exit defect bar gating Phase 8).
  Acceptance smoke `scripts/smoke_phase75.py` SMOKE PASS (P75-1..P75-9,
  isolation-run); tsc + lint clean; smoke_phase4/5 regression re-runs PASS.
- SQLite concurrency posture — **decided and applied (2026-11-18)**: the B5
  load protocol exposed that concurrent Prisma interactive transactions on
  SQLite convoy (5 s socket-timeout quantization → P1008/P2028 failures, up
  to 25 s waits). Posture is now: `PRAGMA journal_mode=wal` (persistent on
  `db/custom.db`) + `DATABASE_URL …?connection_limit=1&pool_timeout=120`
  (single serialized connection — transactions queue on the pool instead of
  colliding on the file lock; measured W=6 concurrent creates: 10.4 s →
  15 ms). The R1 runbook carries this as a startup check. Founder note: when
  the platform migrates off SQLite (§5 roadmap), this posture row is
  superseded by the target DB's pool config.
- Chaos-suite product fixes — **two races fixed in-phase (2026-11-18)**:
  (1) `acquireRobotLease` (S-06) was check-then-upsert — concurrent
  schedulers could double-claim an epoch (chaos X5 observed 3 winners);
  now an atomic INSERT racing the unique constraint + a single conditional
  expired-takeover UPDATE. (2) The Robot Studio wizard wrote Robot +
  StrategyVersion + notification + outbox in four steps — under write
  queueing the transaction expired leaving orphaned robots that can never
  tick (P2028); now one interactive transaction (timeout 20 s, maxWait 10 s)
  — wizard create is all-or-nothing.
- Per-robot tick endpoint — **added (2026-11-18)**:
  `POST /api/robots/[id]/cycle` runs the same engine path as `/api/cycle`
  for ONE robot; external schedulers tick robots concurrently and the S-06
  lease makes double-ticks safe. This is the surface the B5 load protocol
  drives.
- Closed beta — **program locked, cohort NOT yet recruited (2026-11-18)**:
  round 1 starts only on founder-host readiness (fine-grained PAT, B3
  counsel sign-off, 72 h soak host). The exit defect bar gates Phase 8.

## Phase-7 checkpoint status (gated live automation — first real-money path)

- S-08 custody rubric — **executed and recorded (2026-11-18, before any live
  signing)**. Verdict: SELF-CUSTODY confirmed (B1) — the signer key is
  env-injected per process (`POLYMARKET_SIGNER_KEY`) and structurally
  unstoreable (`keyStored: false`; the `Wallet.signingModel` SELF_CUSTODY
  schema invariant), wallets are registered address-only with a
  mismatched-signer refusal, every error path redacts through `redactKey`,
  and the signing chain is proven offline by `scripts/live_selftest.ts`
  (S1–S6 SELFTEST PASS: address derivation, wallet match, EIP-712 struct,
  tick-conformant amounts, payload hash, signature verify). On the founder
  host the same variables carry real credentials, injected per process,
  never stored.
- C19.1 kill-switch drill — **executed as a rehearsal (2026-11-18):
  DRILL PASS** — pause propagation measured across cycles and manual orders;
  becomes an operational cadence from Phase 7.5.
- Phase 7 scope — **locked, implemented and closed** (2026-11-18): B10 gate
  stack (evidence half + execution half, every refusal names what is
  missing), recorded consent C25 (typed phrase + hash binding +
  revoke-to-stop measured under 60 s), small-capital pilot with hard
  ceilings ($20/order, $50 total open live notional, Polymarket-only), the
  Polymarket CLOB write path (EIP-712 L2 auth; book checks: 5 s freshness,
  touch present, +2% slippage sanity, min size), and the **DRY-RUN send
  armor as the default posture** — orders are signed, hashed and journaled
  (`LIVE_ORDER_SIGNED_NOT_SENT`) but never transmitted while the arm switch
  is SAFE; a lost venue ack lands in RECONCILING only (S-01/S-04). Settings
  gains the live-trading control card (arm switch, gate statuses, consent,
  pilot caps, robot mode flips). Acceptance evidence:
  `scripts/smoke_phase7.py` SMOKE PASS (P7-1..P7-13, isolation-run),
  kill-switch drill + signing self-test PASS, tsc/lint clean,
  smoke_phase4/phase5 regression re-runs PASS — full per-item ledger in
  `docs/DEVELOPMENT_PLAN.md` §4 (Phase 7).
- Live sends — **still held**. The arm switch stays SAFE; a real send
  requires, on the founder host: recorded consent + pilot enable, real
  per-process credentials, the real B3 counsel sign-off ([VERIFY] rows; only
  a rehearsal row exists today), and the founder's explicit arm
  (`POLYMARKET_LIVE_WRITE=1`). No self-arming.
- B3 counsel sign-off — rehearsal recorded by the smoke and reset on exit;
  **real counsel sign-off owed before the live pilot** (carry-forward
  register).

## Phase-6 checkpoint status (Robot Studio completion; Drift BET verdict)

- **Drift BET [VERIFY] — venue #4 is NOT landable (recorded 2026-11-18,
  before any adapter work per S-05 §3.2).** Drift Protocol suffered a ~$285M
  exploit on 2026-04-01 (TRM Labs: Lazarus Group social-engineering of multisig
  signers + zero-timelock Security Council migration). drift.trade incident
  updates through 2026-10-01 cover user recovery and a protocol reboot
  contingent on two independent audits (Ottersec, Asymmetric) — no BET
  relaunch announced. `drift.bet` and `bet.drift.trade` were unreachable on
  2026-11-18; third-party trackers list Drift BET offline since the exploit
  (Velocity rebrand). Verdict: adapter deliberately NOT built — S-05
  conformance cannot pass against a dead market; compliance row moved to
  `SUSPENDED` in `src/lib/venue/types.ts`. **Open founder input:** B9 was
  founder-ratified, so the freed #4 slot needs a founder verdict — promote
  Azuro (currently #5), substitute another venue, or hold the slot until a
  relaunch is announced. No lineup change is self-approved.
- Phase 6 — **locked, implemented and closed** (2026-11-18): Robot Studio
  completion — templates P-03 (four launch-family templates, robot-from-
  template parity verified against the DB), guided session (template → first
  backtest in one run, venue-scoped market pick per B11), trace UI depth
  (A-08 front-end: provenance envelope + per-check risk details in a shared
  expansion panel), visual regression harness (pixel + DOM modes) wired into
  the phase smoke. Three-persona usability walkthrough recorded as a scripted
  proxy (`docs/USABILITY_PHASE6.md`, findings F1/F2 fixed in-phase); the
  brief's real three-user check stays owed on the founder host. Acceptance
  evidence: `scripts/smoke_phase6.py` SMOKE PASS (16 checks on live APIs),
  regression re-runs of smoke_phase4 + smoke_phase5 PASS, typecheck/lint
  clean — full per-item ledger in `docs/DEVELOPMENT_PLAN.md` §4 (Phase 6).
  Live trading remains disabled by contract (Phase 7 gates).

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

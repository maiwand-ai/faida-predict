# FAIDA Predict — Development Plan (living document)

> This is the planning source of truth for development. Decisions live in
> `DECISIONS.md`; run instructions live in `README.md`. The founding brief
> (`FAIDA_Predict_Spec_Review_and_Layout_Blueprints.pdf/docx`) stays as the
> point-in-time review record — when this file and the brief disagree, this
> file wins, because it tracks what the founder has actually ratified since.
>
> Rule of use: before starting any phase, re-read this file end to end.
> Before closing any phase, tick its acceptance criteria here and commit the
> tick. Nothing gets dropped because it is written down here.

Last revised: 2026-11-18 (Phase 10 closed — beta operations readiness: the roadmap's declared next step (BETA_PHASE75 round 1) needs instruments the platform lacked; all built + verified — session auth core (scrypt passwords, hashed session tokens per the P-06 pattern, cohort-gated registration consuming BetaMember rows, C4.5 eligibility fail-closed at signup, rate-limited login, one-time operator bootstrap, BETA_STRICT_AUTH strict mode with the honest FOUNDER_FALLBACK disclosed via /api/auth/me); route migration to request-scoped users with member/operator role split and per-robot ownership checks; beta ops API (cohort enrollment, S0–S3 defect ladder as data with S0→uncapped CRITICAL, feedback inbox, R-0 round snapshot, measurable 8-item exit bar with honest FOUNDER_HOST rows, drill PASS markers); UI: Beta Ops view (operator) + member progress/feedback panel + login/register/bootstrap pages + identity chip, badge → 10. In-phase catches: (1) a committed corrupted state declaration in app.tsx (silent parser recovery had hidden it since Phase 7.5) — fixed, recorded; (2) the documented SQLite concurrency posture (WAL + connection_limit=1&pool_timeout=120) had regressed in this sandbox — re-applied per DECISIONS.md/R1, B5 load green again; (3) stale phase-8/9 smoke assertions updated to the Phase 9+ registry truth. smoke P10-1..P10-10 PASS (40 checks, re-run PASS); regressions: phase4, phase5, phase8, phase9, phase75 all PASS isolated; tsc + lint clean.)

---

## 1. Product in one paragraph

FAIDA Predict is a self-hosted platform where users build autonomous trading
robots for prediction markets. Execution is **paper-only** until the Phase 7
gates pass and the user gives recorded consent (C25). The trust architecture
(order state machine, transactional outbox, idempotency, reconciliation,
append-only paper ledger, two-tier risk) is not a feature layer — it is the
product. Every venue, robot, order and decision states which market it
belongs to (B11).

## 2. Ratified founder decisions (B1–B11)

Full reasoning in `DECISIONS.md`. The binding summary:

| # | Decision | Binding choice |
|---|----------|----------------|
| B1 | Custody | SELF-CUSTODY, EIP-712; platform never holds keys; live signing only in Phase 7 |
| B2 | Launch venue | Polymarket only at first; adapter architecture for the rest of the lineup |
| B3 | Jurisdiction | Editable eligibility matrix, EU-first allow set, sanctions hard-blocked, default-deny; [VERIFY] rows need counsel sign-off pre-launch |
| B4 | Pricing | Free/Pro/Professional — engineering drafts, founder approves **before** billing code exists (Phase 8) |
| B5 | Risk defaults | Platform ceilings + user defaults, users only stricter, editable in-app |
| B6 | Robot families | Probability Edge, Market-Making, AI Research at launch; Arbitrage/Parity as family #4 |
| B7 | AI strategy | Provider-agnostic gateway (any key works); deterministic fallback when none |
| B8 | Venue automation | Robots run autonomously post-activation; humans own activation/pause/resume |
| B9 | Venue lineup | See §3 — the final, founder-ratified six-venue lineup |
| B10 | Live money gates | Edge gate + backtest (A-05) + paper session + recorded consent before any live order |
| B11 | Venue visibility | Every robot/order/trace/ticket names its venue; venues without an adapter are visible but refuse robot creation (422) |

## 3. Venue lineup — final (B9, founder-ratified)

`src/lib/venues.ts` is the machine-readable registry; this table is the
contract each adapter must satisfy. **Adapter states**: `LIVE` = market-data
adapter implemented (robots may be created and trade paper on it);
`PENDING` = on the roadmap, robot creation refused (422); `SUSPENDED` =
verdict recorded, not landable (Drift BET, §4 Phase 6). Real orders exist
only on the Phase 7 live path — every other `placeOrder()` still throws by
contract, and the Polymarket write path itself is gated (DRY-RUN armor
signs + audits but sends nothing until the founder arms it).

| Order | Venue | Markets / money | API surface | Status | Binding integration notes |
|-------|-------|-----------------|-------------|--------|---------------------------|
| 1 | **Polymarket** | Polygon PoS, USDC, CLOB order book | Gamma (discovery) + CLOB REST & WebSocket | **LIVE** (market data + gated write path) | Primary venue — where robots earn. Write path (EIP-712 L2 auth) landed in Phase 7 under DRY-RUN send armor — signed, hashed, journaled, nothing transmitted while SAFE. Tick-size regimes and order-type hazards per S-05 catalogue. |
| 2 | **Manifold** | Play money (Mana), free | Public REST `api.manifold.markets/v0` | **LIVE** from Phase 3 | Week-one harness. Binary markets only. Zero-risk proving ground: the whole pipeline (sync → decision → paper fill → ledger → trace) must run on Manifold before the edge gate exists. |
| 3 | **Limitless** | Base network, USDC, order book | API/SDK | **LIVE** from Phase 4 (market data) | Closest Polymarket twin. **Structural thin-liquidity rules, not afterthoughts**: (a) refuse entry if touch depth < configured minimum; (b) edge computed **after** venue fees; (c) per-market position cap. Thin books make robots conservative, not broken. Conformance fixtures: `tests/fixtures/limitless` (`bun run conformance`). |
| 4 | **Drift BET** | Solana, SDK-first | TypeScript SDK | **SUSPENDED** (2026-11-18 verdict, §4 Phase 6) | Offline since the April 2026 ~$285M exploit; S-05 conformance cannot pass against a dead market. Compliance row SUSPENDED with dated evidence; robot creation refused 422. Slot #4 substitution awaits the founder's verdict (B9) — no lineup change is self-approved. |
| 5 | **Azuro** | EVM, sports-leaning | SDK + subgraph odds | **PENDING — adapter built, conformance owed from unblocked vantage (Phase 8)** | Sports events shape: shorter closes, different resolution sources — eligibility matrix and category handling must cover it. Phase 8: adapter implemented against the SDK-verified V3 REST contract (binary prematch conditions, margin-embedded fees, game-level A-04 clusters, close-time structural rule); every feed host is unreachable from the sandbox (dated [VERIFY] evidence in the compliance row) — `record-fixtures-azuro` + `conformance:azuro` must pass from the founder host before the registry flips (no self-approved flip). |
| 6 | **Kalshi** | CFTC-regulated US DCM, USD | REST + RSA/Ed25519 key auth | **LIVE** (market data, Phase 9) | The US-persons complement where Polymarket is venue-restricted. Public market data is UNAUTHENTICATED; trading auth is the platform's **second credential kind** — an asymmetric API key (RSA-PSS/SHA-256 or Ed25519 over `{timestamp}{METHOD}{path}`), env-injected, never stored (`src/lib/live/kalshiCustody.ts`, self-test K1–K6). Mapping scope: binary active non-multivariate markets (MVE combo legs excluded); entry prices = the venue's own asks; touch depth from the bids-only complement (YES ask = 1 − NO bid); fees = round_up(M × 0.07 × C × P × (1−P)) with the series' own `fee_multiplier` (quadratic schedule). Structural rules armed: $50 min touch, $500 per-market cap. S-05 fixtures RECORDED from the live feed (`tests/fixtures/kalshi`). |

Standing rules for every venue adapter, no exceptions:

1. One adapter module implementing `VenueAdapter` (`src/lib/venue/types.ts`) — no venue logic leaks into the engine.
2. One compliance-catalog row (S-05) with `[VERIFY]` items checked against current official docs **before** the adapter lands.
3. One fee schedule in config, never hardcoded.
4. Venue conformance contract tests (S-05) run against a recorded fixture.
5. The engine stays venue-blind: it reads `robot.venue` and the registry.
6. UI states the venue everywhere (B11) — this is already built; adapters must not bypass it.

## 4. Phase ledger — adapted roadmap

The original spec's phases were compressed by the walking-skeleton decision
(R-03): Phase 1 pulled the trust architecture + paper execution forward, and
Phase 2 pulled backtesting (A-05) forward. The ledger below maps the
remaining spec work onto the phase numbers we actually use. Original-spec
section codes (C…, S…, A…, P…, R…) are kept so the brief stays traceable.

### Phase 1 — Walking skeleton (DONE, commit `7b609de`)

Order state machine S-01 (UNKNOWN → reconciliation-only), outbox S-02,
idempotency S-03, paper ledger P-02, risk engine C10/B5 two-tier, eligibility
C4.5, live Polymarket market data (Gamma, read-only), AI gateway A-06
(provider-agnostic), decision traces A-08, brand UI shell. Live trading
disabled by contract.

### Phase 2 — Strategy lab (DONE, commit `1b6a7e9`)

Strategy versioning C5 (immutable versions, activation = pointer move, orders
record the exact version), backtest engine A-05 (deterministic replay,
adverse slippage + fees + liquidity guard, SYNTHETIC/LIVE honesty badge),
price recorder (ticks on every sync and cycle), email fan-out F8 via Resend
(best-effort, honest NO_KEY).

### B11 — Venue awareness pass (DONE, commit `5119177`)

`Robot.venue`, registry-driven API validation (unknown venue 400, pending
venue 422), engine scoping by venue, venue badges/filters/picker across the
whole UI. Venue lineup ratified (`f5352d9`, Kalshi amendment `bbf2574`).

### Phase 3 — Autonomy, venue #2 (Manifold), safety layer (CURRENT)

The original Phase 3 core (risk engine, paper execution, first rule-based
robot) shipped early with Phase 1. What remains of it, plus the founder's
venue plan, is this phase's scope:

- **P3.1 — Manifold adapter → LIVE.** Public REST sync (binary markets,
  probability → cents), venue-aware sync API (`POST /api/markets {venue}`),
  tick source `MANIFOLD_SYNC`, compliance row updated, registry flips
  MANIFOLD to LIVE. Robots on Manifold run the full paper pipeline.
  *Acceptance: ≥20 Manifold markets synced; a Manifold robot completes
  decision → paper fill → ledger → trace end to end; Polymarket sync
  unchanged.* — **sandbox-verified 2026-11-16: 30 markets synced; Manifold
  robot traded the full pipeline; Polymarket resync unchanged (30 markets).**
- **P3.2 — Robot autonomy (S-06 loop leases, B8).** Autopilot runner:
  interval-driven cycles + reconciliation passes without manual clicks;
  per-robot lease so a retried tick or a second worker can never double-run
  a robot; lease expiry allows takeover. Human owns start/stop (B8).
  *Acceptance: two overlapping cycle calls on the same robot — exactly one
  runs; autopilot on/off from the UI; interval persisted.* —
  **sandbox-verified 2026-11-16: parallel cycles show lease refusal; autopilot
  ran on the persisted 30 s cadence from the UI.**
- **P3.3 — Global pause / kill switch (C19/S-07).** Platform-wide pause with
  reason; every cycle and every order path checks it first; propagation is
  **measured** (time from pause decision to first refused tick), not
  asserted; CRITICAL notification via outbox; red banner in UI. Kill-switch
  drill (C19.1) executed pre-Phase 7 on 2026-11-18 (rehearsal DRILL PASS,
  §4 Phase 7); operational cadence from 7.5.
  *Acceptance: pause mid-run stops new decisions; refused ticks carry the
  pause reason; measured propagation time logged; resume restores.* —
  **sandbox-verified 2026-11-16: cycles AND manual tickets refused with
  reason + measured propagation; banner + CRITICAL notification render.**
- **P3.4 — Pre-trade staleness gate (S-10).** A robot refuses to decide on
  market data older than the configured freshness threshold (platform
  control, default 15 min for sync-fed paper; the B5 5-second book budget
  applies when the live book adapter arrives in Phase 7). Refusals are
  recorded in the trace with the measured age.
  *Acceptance: forcing an old `updatedAt` produces a STALE_DATA no-trade
  trace with the age stated.* — **sandbox-verified 2026-11-16: stale Gamma
  rows produced STALE_DATA refusals with measured age; fresh Manifold rows
  passed the gate and traded.**
- **P3.5 — Paper soak runner (adapted 72-hour soak, C28).** `scripts/soak.ts`
  drives cycles on an interval for a configurable duration against a running
  instance, then reports: traces completeness, unresolved reconciliation
  entries, UNKNOWN orders. Soak verdict written to `soak-report.json`.
  *Acceptance (full soak, on the founder's host): zero unresolved drift
  entries at the end; every cycle produced a trace; no unhandled errors.* —
  **smoke variant PASS 2026-11-16 (6 runs, 24/24 traces, 0 errors, 0
  unresolved drift, 0 unknown orders). Full 72 h soak owed on the founder
  host. Bonus fix found by the soak: reconciliation resolution now closes
  open drift entries (S-04) and looks up the venue adapter per order.**

**Non-goals for Phase 3:** live orders of any kind; billing; Limitless /
Drift / Azuro / Kalshi adapters; AI estimator upgrades (Phase 5); multi-user
accounts (Phase 8).

### Dashboard pass — venue-first cockpit (DONE, commit `aeccfe5`)

Between-phase UI scope requested by the founder (2026-11-16, MT5 FAIDA
screenshots used as inspiration, not a spec). The default view is now a
dashboard that answers the founder's three questions at a glance:

1. **Total balance** — KPI band: paper balance, risk exposure (+ meter vs
   per-event cap), today's net flow, in-trade count with paper mark.
2. **What is in trade** — "In trade now" table: venue · market · robot ·
   side · size · entry→mark · unrealized P/L. Marks reuse the risk-engine
   formula (same math as `src/lib/risk.ts`) so UI and risk checks can never
   disagree. Glanceable status strip: autopilot, adapters live, markets
   synced, robots active/paused, alerts, outbox, pause banner (C19).
3. **Venue → its options** — registry-driven venue grid (B9 lineup always
   visible, "IN TRADE" ribbon on live exposure): pick a venue → its
   workspace (robots, markets, positions, orders, traces) → "+ Create robot
   on <venue>" opens the studio wizard pre-scoped to that venue. Pending
   venues render an honest "adapter pending" panel and the CTA stays
   disabled — creation still refused per B11.

Implementation: no schema changes; per-venue rollup + alert count +
per-position `unrealizedCents` added to `/api/dashboard`; new
`src/components/faida/dashboard.tsx` (`DashboardView`, `VenueWorkspace`);
old Overview view retired.
*Acceptance: typecheck + lint clean; browser-verified golden path
(dashboard → Manifold workspace → pre-scoped wizard → pending-venue state
on Kalshi with disabled CTA); mobile stacking verified.*

### Venue color identity pass (B12, founder-requested before Phase 4)

Each venue now wears a distinct accent so the user always sees which market
they entered: Polymarket `#3E8EFF` (electric blue), Manifold `#14D9C4`
(turquoise), Limitless `#F26BC8` (magenta), Drift BET `#C6F542` (lime),
Azuro `#B18CFF` (lavender), Kalshi `#FFB25C` (orange). `VenueDef.hex` in
`src/lib/venues.ts` is the single source; a `vc-*` utility layer in
`globals.css` derives tints, borders, strips and glows from one CSS var
(`--vc`) via `color-mix`, so pending venues render their hue muted toward
slate until the adapter ships. Applied to: dashboard venue cards (color
strip, hover glow, in-trade chip), venue workspace interior (header glow,
venue-colored primary CTA, section heading dots), every VenueBadge, Markets
venue sections, the studio venue picker (selected row tints in the venue
color) and the manual trade ticket (dialog strip + side buttons + place
button). Role chips (PRIMARY/HARNESS/FAST-FOLLOW) went neutral gray so the
venue hue carries the identity. No behavior changes — colors only.

### Phase 4 — Venue #3 (Limitless) + exposure intelligence (DONE, commit pending push)

Limitless adapter with the **structural thin-liquidity rules** from §3
(min-depth refusal, edge-after-fees, per-market cap). Event clustering A-04
(so complementary exposure across related markets stacks visibly in risk
checks). S-05 conformance fixtures for Limitless. *Acceptance: thin-book
markets refuse entry with a stated depth reason; clustered positions sum in
per-event exposure.*

- **P4.1 — Limitless adapter → LIVE with structural data capture.** Public
  REST sync (`/markets/active` pagination at the 25/page cap →
  `/markets/{slug}/orderbook`, books best-effort, fail-closed on gaps);
  per-side touch depth (USDC notional at best ask for YES, best-bid
  complement for NO) and per-side taker fee bps captured **at sync** and
  stored on the market; registry flips LIMITLESS to LIVE; compliance row
  updated with the documented fee regimes. Robots on Limitless run the full
  paper pipeline; thin books make robots conservative, not broken.
  *Acceptance: ≥20 Limitless markets synced with structural data; Polymarket
  and Manifold syncs unchanged.* — **sandbox-verified 2026-11-17: 30 markets
  synced, all 30 with book depth + fee bps (`source: LIMITLESS_LIVE`);
  Polymarket resync 30 markets, Manifold unchanged.**
- **P4.2 — Structural thin-liquidity rules (S-05/B9 §3).** `src/lib/venue/rules.ts`
  declares the venue's entry rules as config, the shared risk engine applies
  them (engine stays venue-blind): (a) min-touch-depth refusal with the
  measured depth stated in the refusal, fail-closed when no book was
  captured — applies to robots AND manual tickets; (b) edge computed AFTER
  venue taker fees (fee drag `p × bps` in probability points, stored bps per
  side at sync, fee charged on paper fills so paper P/L matches a live
  taker); (c) per-market position cap ($500, user-wide across all robots).
  Founder-calibrated 2026-11-17 against measured books: minimum touch depth
  $50, per-market cap $500.
  *Acceptance: thin-book markets refuse entry with a stated depth reason.* —
  **sandbox-verified 2026-11-17: manual ticket on a thin book (touch 677¢)
  refused 422 `touch_depth — LIMITLESS rule (a): YES touch depth 677¢ vs
  minimum 5000¢`; manual ticket on the liquid book (touch 9990¢) FILLED with
  the venue taker fee charged on the fill; cycle refusal carries the same
  stated rule.**
- **P4.3 — S-05 conformance fixtures + contract test.**
  `scripts/record-fixtures-limitless.ts` records the live API responses
  (page 1 + 2 of `/markets/active?sortBy=high_value`, the orderbooks of one
  liquid and one thin market) into `tests/fixtures/limitless` with a
  provenance manifest; `bun run conformance` runs the adapter against the
  recorded fixtures offline — mapping, parity, depth derivation, fee regimes
  (documented anchors), fee drag, rules arming, refuse/allow verdicts, and
  the hard live-write block. Fixtures are committed (gitignore now exempts
  `/tests/fixtures` — the recording had silently been excluded).
  *Acceptance: conformance runs green against a recorded fixture.* —
  **sandbox-verified 2026-11-17: 33/33 PASS (liquid 26600¢ vs thin 151¢).**
- **P4.4 — Event clustering A-04 (exposure intelligence).** Markets sharing
  an `eventKey` (venue-prefixed: `pm:event:…`, `lx:group:…`, `lx:event:…`)
  have their open exposure **summed** in the per-event exposure check, so
  complementary positions on related markets can never hide apart; the
  refusal states the stacked sum, the markets in the cluster and the cap.
  Without a cluster key the check degrades to the single-market sum (Phase ≤3
  behavior). Polymarket resync backfills `eventKey` from Gamma slugs;
  dashboard positions carry CLUSTER chips and the portfolio-risk card shows
  cluster exposure.
  *Acceptance: clustered positions sum in per-event exposure.* —
  **sandbox-verified 2026-11-17: Fed December-decision cluster
  (`pm:event:fed-decision-in-december-2026…`): four orders across two
  cluster markets filled 10000→20000¢ of the 20000¢ cap, the 5th refused
  422 with `A-04 cluster …: 2 markets, open exposure 20000¢ + this order
  5000¢ = 25000¢ ≤ 40% of allocation (20000¢)`.**

**Non-goals for Phase 4 (kept):** live orders of any kind; billing;
Drift/Azuro/Kalshi adapters; AI estimator upgrades (Phase 5); multi-user
accounts (Phase 8). Verification evidence: `bunx tsc --noEmit` clean,
`bun run lint` clean, `bun run conformance` 33/33 PASS,
`scripts/smoke_phase4.py` PASS (all acceptance criteria on live APIs),
screenshot pass over the four touched views (§7.4).

### Phase 5 — Probability & AI layer hardening (DONE, commit pending push)

Model registry A-01 (promotion/demotion by calibration), forecast provenance
A-02, baseline definition A-03, evidence integrity + prompt-injection
screening A-06, AI cost/latency governance A-07 (per-provider budgets,
cache). The **edge gate (B10)** starts consuming real evidence here.
Demotion drills pass before this phase closes.

- **P5.1 — Baseline definition (A-03).** The baseline estimator is the
  deterministic contrarian heuristic, now a first-class registry row
  (`heuristic-contrarian-v1`) with its formula recorded in PlatformControl
  (`MODEL_BASELINE`) and in DECISIONS.md: `est = clamp(p + round((50 − p) ×
  tilt / 100), 2, 98)`, tilt 25. It is the floor every model must beat; the
  baseline Brier on any calibration sample is derived **analytically** from
  the recorded book price, so model comparisons can never cherry-pick their
  sample. Registry knobs (min samples 30, promotion margin 5%, demotion
  tolerance 5%) live in PlatformControl (`MODEL_KNOBS`), not folklore.
- **P5.2 — Model registry (A-01).** `ProbabilityModel` table + `src/lib/
  probability/registry.ts`: every estimator is a row (HEURISTIC/AI kind,
  ACTIVE/CANDIDATE/DEMOTED/RETIRED status); keys seen in traces register on
  sight; legacy traces backfill their model key from the stated basis.
  Calibration recomputes per model over resolved forecasts (Brier, log loss,
  live/synthetic evidence split per D-03). Promotion eligibility: ≥ min
  samples AND Brier < baseline × (1 − margin); the founder promotes via
  Settings (B8 — humans own activation; a disabled provider's model refuses).
  Demotion: an ACTIVE model whose recent window drifts worse than baseline ×
  (1 + tolerance) is demoted, the baseline re-activates, WARNING notification
  + `MODEL_DEMOTED` outbox event. Exactly one ACTIVE model drives cycles.
  *Acceptance: demotion drills pass.* — **sandbox-verified 2026-11-17:
  `scripts/demotion_drill.py` DRILL PASS — promotion round trip (eligible →
  promoted → baseline steps down), corrupted-window demotion (brier 0.9016
  vs baseline 0.4425 → DEMOTED → baseline ACTIVE), audit trail recorded,
  post-demotion cycle estimates with the baseline.**
- **P5.3 — Forecast provenance (A-02).** Every DecisionTrace now records
  `modelKey` + a provenance envelope: kind, provider/model, latency, cache
  state, `evidenceHash` (sha256 of market id, venue, question, book state),
  screening verdict, estimator version, and an honest `fallbackFrom` when the
  chain fell back to the baseline. The dashboard and venue workspaces show a
  model chip on every trace (BL / AI:<PROVIDER> · cache-HIT · screening
  flag). A forecast without provenance is not evidence.
- **P5.4 — Evidence integrity + prompt-injection screening (A-06).**
  `src/lib/probability/screening.ts` screens market text before any prompt:
  instruction-override, role-impersonation, chat-template tokens, prompt-leak
  requests, output-contract steering, JSON directive smuggling, control
  characters. Flagged evidence never reaches an AI prompt — fail-closed, the
  baseline estimates and the trace carries the FLAGGED verdict.
  *Acceptance: injected market text produces a FLAGGED trace estimated by the
  baseline.* — **sandbox-verified 2026-11-17 (smoke P5-2).**
- **P5.5 — AI cost/latency governance (A-07).** Every AI attempt lands in
  `AiCallLog` (provider, latency, cost, outcome OK/FAILED/BUDGET_BLOCKED);
  `AiCacheEntry` serves identical (provider, model, market state) estimates
  within the TTL free (`AI_CACHE_TTL_S`, default 6 h); crossing a provider
  budget raises ONE `AI_BUDGET` notification and budget-blocked attempts are
  logged, never silent. Settings card: calls 24 h, failed/blocked, p50/p95
  latency, cache hit rate, per-provider spend bars.
  *Acceptance: second identical estimate is a HIT; zero-budget provider logs
  BUDGET_BLOCKED and the trace states the fallback.* — **sandbox-verified
  2026-11-17 (smoke P5-4).**
- **P5.6 — Edge gate consumes evidence (B10).** `src/lib/probability/
  edgeGate.ts` + `GET /api/probability?robotId=…` aggregate the six evidence
  checks: MODEL_CALIBRATED (active model vs baseline floor), PROVENANCE_
  COMPLETENESS (≥95% of recent traces carry provenance), EVIDENCE_CLEAN (no
  trades on flagged evidence), BACKTEST_EVIDENCE (A-05), PAPER_SESSION (≥20
  traces), RECORDED_CONSENT_C25 (false by contract until Phase 7). The gate
  reports honestly and `ready` stays false — Phase 7 owns the execution
  gates. **sandbox-verified 2026-11-17 (smoke P5-5).**

**Non-goals for Phase 5 (kept):** live orders of any kind; billing; Drift/
Azuro/Kalshi adapters; Robot Studio UX (Phase 6); multi-user accounts
(Phase 8). Verification evidence: `bunx tsc --noEmit` clean, `bun run lint`
clean, `scripts/demotion_drill.py` DRILL PASS, `scripts/smoke_phase5.py`
SMOKE PASS (28 checks on live APIs), screenshot pass over Settings (registry
+ governance cards) and dashboard traces (§7.4).

### Phase 6 — Robot Studio completion + venue #4 (Drift BET) — **DONE (commit ca607cd), delivered to GitHub**

Robot templates P-03, trace UI depth (A-08 front-end), visual regression,
three-user usability check (template → first backtest in one guided
session). Drift BET adapter per §3 contract.

- **P6.1 — Robot templates (P-03).** `src/lib/robotTemplates.ts` ships four
  templates across the B6 launch families, each with a full payload (capital,
  risk stops, strategy knobs, venue, guided path text) served via
  `GET /api/robot-templates`; the Studio step-1 gallery shows template cards +
  "Start from scratch" first, and applying a template prefills the wizard down
  to the review term sheet. Parity is checked, not assumed: a robot created
  from a template payload matches the template's capital, risk stops and C5
  knobs in the DB (Robot row + immutable StrategyVersion v1).
  *Acceptance: template → robot parity.* — **sandbox-verified 2026-11-18
  (smoke P6-1/P6-2).**
- **P6.2 — Guided session (template → first backtest in one run).** Applying
  a template opens the guided panel with three numbered steps; cycle summaries
  include the new robot (step 2) and the first backtest (step 3) picks its
  default market **on the robot's venue** (B11) and prefers candidates with
  ≥20 recorded ticks. Usability finding F1 (a fresh database honestly refused
  the first backtest on thin tick history) produced two fixes: venue-scoped
  default-market pick and per-venue 120-tick SYNTHETIC-labeled seed history.
  *Acceptance: one guided session reaches the first backtest.* —
  **sandbox-verified 2026-11-18 (smoke P6-3; persona A retry).**
- **P6.3 — Trace UI depth (A-08 front-end).** Fresh DecisionTraces carry
  `riskChecks` + `provenance` JSON and the depth fields (`trigger`,
  `strategyVersionId`); the dashboard and venue workspaces share an expansion
  panel that shows the provenance envelope (model chip, kind, estimator
  version, cache state, PASS/FLAGGED screening verdict, evidence hash) and
  every pre-trade risk check with its measured detail, collapsed to the
  glanceable verdict by default.
  *Acceptance: a trace can be audited from the UI alone.* —
  **sandbox-verified 2026-11-18 (smoke P6-4; persona C walkthrough).**
- **P6.4 — Visual regression.** `scripts/visual-regression.ts` runs two
  modes — pixel hash over touched views and DOM structure assertions — and
  exits 0 on the current stack; wired into the phase smoke so a UI break
  fails acceptance.
  *Acceptance: harness exits 0.* — **sandbox-verified 2026-11-18
  (smoke P6-6).**
- **P6.5 — Usability walkthrough (three personas, scripted proxy).**
  `docs/USABILITY_PHASE6.md`: three scripted persona sessions (first-time
  trader / quant tinkerer / operator) driven through the real UI over the
  live stack. Findings register F1 (guided backtest refused on a fresh DB —
  correct refusal, wrong guidance; **fixed in-phase**), F2 (strategy knobs
  hidden in step 2; **fixed in-phase**), F3 (no trace-depth defect found).
  Honest limits recorded: scripted operator, sandbox stack — the brief's
  real three-user check stays owed on the founder host (open inputs).
- **P6.6 — Drift BET verdict (venue #4): adapter deliberately NOT built.**
  Before any adapter work (S-05 §3.2 discipline), the venue failed its own
  [VERIFY]: Drift Protocol suffered the April 1 2026 ~$285M exploit
  (Lazarus social engineering of multisig signers), the protocol entered a
  reboot contingent on two independent audits, `drift.bet` /
  `bet.drift.trade` were unreachable on 2026-11-18 and no BET relaunch is
  announced. A dead market cannot pass S-05 conformance, so the compliance
  row is `SUSPENDED` with dated evidence in `src/lib/venues.ts`, robot
  creation for DRIFT_BET is refused 422, and no template recommends the
  suspended venue. **This is a recorded deviation from the phase plan, not a
  silent drop** — the freed slot #4 needs a founder verdict (promote Azuro,
  substitute another venue, or hold for a relaunch); no lineup change is
  self-approved (B9).
  *Acceptance: verdict demonstrated.* — **sandbox-verified 2026-11-18
  (smoke P6-5).**

**Non-goals for Phase 6 (kept):** live orders of any kind; billing; Azuro/
Kalshi adapters; multi-user accounts (Phase 8). Verification evidence:
`bunx tsc --noEmit` clean, `bun run lint` clean, `scripts/smoke_phase4.py`
and `scripts/smoke_phase5.py` regression re-runs PASS (each phase smoke is
isolation-run — they reset their own state and back-to-back sequencing trips
cross-suite assertions),
`scripts/smoke_phase6.py` SMOKE PASS (16 checks on live APIs), screenshot
pass over Studio template gallery, strategy knobs, expanded dashboard trace
and venue workspace (§7.4).

### Phase 7 — Gated live automation (first real money) — **DONE, delivered to GitHub**

B1 custody rubric executed and recorded in DECISIONS.md (S-08 evidence);
EIP-712 signing; Polymarket CLOB write path; Phase 7 gates (B10): edge gate
+ A-05 backtest + paper session + recorded consent C25; pause propagation
and revocation-to-stop measured (≤60 s target); geographic transitions
tested. Small-capital pilot only.

- **P7.1 — Custody (B1/S-08).** `src/lib/live/custody.ts`: the signer key is
  env-injected per process (`POLYMARKET_SIGNER_KEY`) and structurally
  unstoreable (`keyStored: false`; the `Wallet.signingModel` SELF_CUSTODY
  schema invariant); wallet registration is address-only with a
  mismatched-signer refusal; every error path redacts through `redactKey`.
  `scripts/live_selftest.ts` proves the signing chain offline (S1–S6:
  address derivation, wallet match, EIP-712 struct, tick-conformant 6-decimal
  amounts, payload hash, signature verify).
  *Acceptance: keys unstoreable + signing chain proven.* — **sandbox-verified
  2026-11-18 (smoke P7-2/P7-3; SELFTEST PASS).**
- **P7.2 — Recorded consent (C25).** `src/lib/live/consent.ts` + `/api/consent`:
  typed-phrase authorization ("I AUTHORIZE LIVE TRADING") with wallet
  address + caps acknowledgment bound into a consent hash; wrong phrase 403;
  revocation closes every gate on the next read; `CONSENT_RECORDED` outbox
  event persists (S-02).
  *Acceptance: consent records with hash binding; revoke stops the live
  robot ≤60 s naming the gate in the trace.* — **sandbox-verified 2026-11-18
  (smoke P7-4/P7-10).**
- **P7.3 — Small-capital pilot + B3 sign-off row.** `src/lib/live/pilot.ts`:
  hard structural ceilings — $20 per order, $50 total open live notional,
  Polymarket-only whitelist — the founder-facing API can tighten but never
  loosen; pilot enable is refused 422 without recorded consent; the B3
  counsel sign-off records as a row (rehearsal in sandbox, reset on exit —
  real counsel sign-off owed before the live pilot).
  *Acceptance: refusals before consent; caps clamp to ceilings; venue
  whitelist enforced.* — **sandbox-verified 2026-11-18 (smoke
  P7-5/P7-12/P7-13).**
- **P7.4 — B10 gate stack.** `src/lib/live/gates.ts` + `edgeGate.ts`: the
  evidence half (MODEL_CALIBRATED, PROVENANCE_COMPLETENESS, CLEAN_EVIDENCE,
  BACKTEST_EVIDENCE, PAPER_SESSION, RECORDED_CONSENT) + the execution half
  (ROBOT_MODE, VENUE_LIVE_WRITE, custody, credentials, pilot caps, B3
  sign-off, geo). Every check names what is missing (D-04); the LIVE_PILOT
  flip is refused 422 with the blocking list until the evidence exists, and
  the gate re-runs on every read so a consent revoke, geo flip or demotion
  closes the path immediately.
  *Acceptance: flip refused → evidence → flip succeeds, gate ready in the
  SAFE posture.* — **sandbox-verified 2026-11-18 (smoke P7-7/P7-8).**
- **P7.5 — CLOB client + the execution path.** `src/lib/live/clobClient.ts`
  (public book fetch with the B5 freshness clock, tick-conformant amount
  encoding, EIP-712 order struct over the domain table keyed by book shape,
  L2 HMAC auth headers, send boundary; clients identify themselves with a
  real UA after the sandbox 403 finding) and `src/lib/live/execute.ts` —
  the only way a real order leaves the platform: pause (C19) → gate → geo
  → pilot caps → LIVE ledger balance → CLOB book (5 s freshness, present
  touch, +2% slippage sanity, min size) → sign (EIP-712, self-custody) →
  **DRY_RUN armor** (`POLYMARKET_LIVE_WRITE` unset ⇒ signed + audited + NOT
  sent) → send with ACK-lost → RECONCILING only (S-01/S-04). The signed
  payload sha256 and the domain + amounts are journaled either way.
  *Acceptance: DRY-RUN end-to-end on the live CLOB book — signed, hashed,
  journaled, nothing sent.* — **sandbox-verified 2026-11-18 (smoke P7-9:
  live-book probe + signed order + `LIVE_ORDER_SIGNED_NOT_SENT`).**
- **P7.6 — Kill-switch drill (C19.1).** `scripts/kill_switch_drill.py` — the
  scheduled operational drill the carry-forward register owes before Phase
  7: pause propagation across cycles and manual orders with measured
  seconds; becomes an operational cadence from 7.5.
  *Acceptance: DRILL PASS.* — **sandbox-verified 2026-11-18 (smoke P7-1).**
- **P7.7 — Live control surface.** `/api/live` (custody/consent/pilot/B3/
  gate/arm-switch state + ENABLE_PILOT, SET_CAPS, REGISTER_WALLET,
  SET_ROBOT_MODE, B3_SIGNOFF), `/api/live/orders` (manual live order through
  the same path) and the Settings `LiveTradingCard`: arm-switch badge
  (SAFE/ARMED), gate statuses, consent record/revoke, wallet register, caps,
  robot mode flips — refusals shown verbatim (D-04). Engine integration:
  LIVE_PILOT robots route through the live path in `cycle.ts` with
  consent/geo stops measured in the cycle summaries; paper engine and
  reconciliation stay mode-aware.
  *Acceptance: the flip and every refusal are operable from the UI alone.* —
  **sandbox-verified 2026-11-18 (smoke P7-7..P7-12 hit the same APIs the
  card calls).**

**Non-goals for Phase 7 (kept):** no real funds move in the sandbox (fixture
key #0, zero funds, arm switch SAFE — the smoke ends the platform paper-only);
no ARMED send without founder authorization + real B3 counsel sign-off on
the founder host; billing (Phase 8); Azuro/Kalshi adapters. Verification
evidence: `bunx tsc --noEmit` clean, `bun run lint` clean,
`scripts/kill_switch_drill.py` DRILL PASS, `scripts/live_selftest.ts`
SELFTEST PASS (S1–S6), `scripts/smoke_phase7.py` SMOKE PASS (P7-1..P7-13,
isolation-run), smoke_phase4 + smoke_phase5 regression re-runs PASS, visual
regression green after the documented Settings re-baseline (the live-trading
card joined the clipped region). S-08 custody rubric verdict recorded in
`DECISIONS.md`.

### Phase 7.5 — Hardening + closed beta (R-02, locked) — **DONE, delivered to GitHub**

Runbooks written and drilled; C19.1 re-executed on the 7.5 cadence; load
measured at the B5 targets; chaos suite executed and reviewed; closed-beta
program locked. Evidence per item (all 2026-11-18, sandbox; founder-host
reruns owed where noted):

- **P75.1 — Runbooks (six, written AND drilled).** `docs/RUNBOOKS.md`: R1
  startup reconciliation, R2 stuck-robot diagnosis, R3 venue outage, R4 fee
  update, R5 jurisdiction update, R6 model demotion, plus the standing C19.1
  drill and a drill matrix with evidence dates. Every procedure references
  the real API surface, DB tables and invariants (S-01/S-04, S-06, S-10, B11,
  C4.5, C4.4) — nothing generic.
- **P75.2 — Runbook drills R1–R5.** `scripts/drill_phase75.py` drives each
  procedure through the real stack, self-cleaning: DRILL PASS (28 checks) —
  UNKNOWN order resolved via venue evidence only (S-01), drift closed (S-04),
  outbox drained; stuck lease refuses naming the holder then takeover after
  expiry; venue outage fails closed under an 8-tick burst naming the venue
  (B11); a +300 bps fee bump reprices the very next tick's drag by the C4.4
  formula (p × bps / 10000); jurisdiction flip refuses orders at ELIGIBILITY
  and sanctioned rows stay unflippable (403, hard invariant).
- **P75.3 — Chaos suite executed and reviewed.** `scripts/chaos_phase75.py`
  X1–X6: CHAOS PASS (25 checks) — outage burst, adversarial freshness budget
  (S-10 clamp honored), pause mid-burst with MEASURED propagation (C19), B10
  flip fail-closed with named blockers, 12-way lease storm against a held
  lease, UNKNOWN-never-fills-without-evidence (no money movement). **Review
  verdict: the suite earned its keep — it exposed two real races and one
  config hazard, all fixed in-phase:** (1) `acquireRobotLease` was check-
  then-upsert; under concurrent schedulers three contenders could win one
  epoch — now an atomic INSERT-or-conditional-takeover (S-06 hardening, X5
  re-verified); (2) the Robot Studio wizard wrote Robot + StrategyVersion +
  notification + outbox in four steps — under SQLite write queueing the
  transaction expired (P2028) leaving orphaned robots that can never tick —
  now one interactive transaction (timeout 20 s, maxWait 10 s); (3) DELETE
  journal mode + untuned Prisma pool convoyed under concurrent transactions
  (5 s socket-timeout quantization, P1008/P2028) — posture now
  `journal_mode=wal` (persistent) + `DATABASE_URL
  …?connection_limit=1&pool_timeout=120` (documented in DECISIONS.md; the R1
  startup check references it).
- **P75.4 — Load at B5 targets.** `scripts/load_phase75.py`: 500 robots
  seeded through the real wizard API, every robot ticked concurrently through
  the per-robot tick endpoint (`POST /api/robots/[id]/cycle`, added in 7.5 —
  the S-06 leases make external schedulers safe), health probed across the
  window. **B5 PASS at the protocol concurrency (16):** 500/500 ticks, zero
  5xx, 500/500 DecisionTraces, decision latency p95 **699 ms ≤ 750 ms**
  (p50 339 ms), availability **100% ≥ 99.5%** (20/20 probes), throughput
  44 robots/s. Stress pass at a 32-way lockstep burst recorded honestly:
  capacity and availability still hold (500/500, 100%) but p95 is 977 ms —
  a lockstep burst exceeds the latency budget; paced schedulers do not.
  D-03 labeling: sandbox dev server, SQLite — the founder-host production
  re-run is owed before the live pilot scales (beta exit item 5).
- **P75.5 — Closed beta program locked.** `docs/BETA_PHASE75.md`: cohort
  10–25 (paper + small live under the Phase 7 ceilings), six-step weekly
  rounds (R-0..R-5) with a per-round runbook rehearsal and C19.1 drill, S0–S3
  defect ladder, and a measurable exit defect bar (zero open S0/S1, ≤ 3 open
  S2, invariants re-verified ≤ 7 days, all runbooks drilled ≤ 14 days, B5
  founder-host pass, 72 h soak, DRY-RUN live-pilot sanity, cohort signal).
  Round 1 starts on founder-host readiness (B3 counsel sign-off + founder
  host; PAT delivered and commits pushed 2026-11-18).
- **P75.6 — Acceptance smoke.** `scripts/smoke_phase75.py`: SMOKE PASS
  (P75-1..P75-9, isolation-run) — docs checks, R1–R5 + R6 + C19.1 + chaos +
  B5-short as subprocesses, per-robot endpoint graceful degradation, platform
  ends SAFE (pause off, paper-only).
- **Verification protocol:** `bunx tsc --noEmit` clean, `bun run lint` clean,
  smoke_phase4 + smoke_phase5 regression re-runs PASS (isolated). Carry-
  forward updates: B5 latency p95 + load measured (row below); C19.1 moves to
  the 7.5 monthly/beta-round cadence; R-01 defaults stand, founder-host
  revisit owed at the live pilot.

**Non-goals for Phase 7.5 (kept):** no billing (Phase 8, B4 pricing owed); no
Azuro/Kalshi adapters (Phases 8/9); no ARMED live send (founder authorization
on the founder host); beta round 1 does NOT start until the founder host is
ready — the program doc is the contract, not a claim that users exist.

### Phase 8 — Commercial platform + venue #5 (Azuro) — **engineering scope DONE (2026-11-18); billing gated on founder B4 approval + beta exit bar**

Founder directive: "continue phase 8" (2026-11-18). The beta exit bar gates
Phase 8 **billing** specifically (BETA_PHASE75 §4: "commercialization never
starts on top of an open S0/S1"); the founder directed the non-billing
engineering scope forward while beta round 1 still awaits founder-host
readiness. Every item below carries its evidence (all 2026-11-18, sandbox):

- **P8.1 — B4 pricing drafted, NOT wired.** `docs/PRICING_B4.md`: Free/Pro/
  Professional tiers with AI-credit allowances, entitlement-snapshot contract
  (C5-pattern snapshots, named refusals), dunning ladder (14-day grace, no
  data deletion), refunds/proration P-05 policy + [VERIFY] tax row, pluggable
  provider posture. **No billing code exists** — the phase smoke asserts the
  negative (P8-8c: zero payment-SDK markers in src/), DECISIONS.md B4 stays
  PENDING, and the beta exit bar holds. The founder's approval checklist is
  §7 of the draft. P-01 organization schema stays unwritten with it (modeled
  "when billing lands").
- **P8.2 — Azuro venue #5 (adapter built, venue honestly PENDING).** S-05
  [VERIFY] executed BEFORE adapter work per §3.2: the protocol is alive
  (azuro.org + docs active; official @azuro-org/toolkit v7.2.0, npm
  2026-10-10, pins the V3 contract — REST `api.onchainfeed.org/api/v1/public`
  market-manager, environments PolygonUSDT/BaseWETH, GameState/ConditionState
  enums, margin embedded in odds) and the adapter is IMPLEMENTED against it
  (`src/lib/venue/azuro.ts`: games-by-filters + conditions-by-game-ids,
  binary Active prematch conditions only, sports-shape handling — closeDate
  = game start, league/country/provider resolution source, sport-slug
  categories, A-04 eventKey = game). BUT every Azuro feed host returns
  origin-level 404 from the sandbox (api/dev-api/preprod/api.azuro.org,
  streams host, and thegraph.onchainfeed.org does not resolve) across
  HTTP versions/methods/headers while Gamma/Manifold/Limitless/CLOB all
  answer from the same vantage — conformance fixtures CANNOT be recorded
  here. **Verdict (Drift precedent, proportionate): compliance row
  VERIFY_BLOCKED with dated evidence; venue stays PENDING; robot creation
  refused 422; registry flip owed after `bun scripts/record-fixtures-azuro.ts`
  + `bun run conformance:azuro` pass from an unblocked vantage (founder
  host).** Structural rules armed for the sports shape (rules.ts rule (d):
  `minMinutesBeforeClose` = 20 min generic close-time window, fail-closed on
  missing closeDate, enforced in the shared risk engine for any venue that
  declares it; $100 per-market cap; depth rule deliberately NOT armed — the
  feed exposes no book and arming it would fail-close everything).
  *Acceptance per §3 standing rules: adapter module ✓, catalog row ✓ (with
  [VERIFY] evidence), fee schedule config ✓ (per-condition margin/overround →
  bps), conformance harness ✓ (honest SKIP without fixtures — never a fake
  pass), engine venue-blind ✓, UI venue naming ✓ (B11 badges unchanged).*
- **P8.3 — P-04 notification taxonomy + anti-storm.** `src/lib/notifications.ts`
  is now the SINGLE writer (all 8 former creation sites routed through it):
  seven-family taxonomy (RISK, EXECUTION, AI_BUDGET, MODEL_GOVERNANCE,
  SYSTEM, COMPLIANCE, BILLING-dormant), per-family policy = severity +
  dedupe window + hourly cap + digest. CRITICAL is never capped (kill-switch
  breaks through by construction). Suppressed attempts are RECORDED as
  suppressed rows (the storm is provable, never silently dropped) and the
  feed collapses DIGEST families at read time. `GET /api/notifications`
  returns the feed + digest groups + per-family delivered/absorbed accounting.
  Evidence: storm probe through the real notifyUser path — dedupe absorbed
  repeats, cap absorbed beyond headroom (smoke P8-3a..P8-3f with
  baseline-relative expectations).
- **P8.4 — P-06 export + read-only API keys.** `ApiKey` model: plaintext
  shown once, SHA-256 hash stored (constant-time compare), scope READ_ONLY
  only — no write surface exists at all. `POST/GET/DELETE /api/keys`
  (lifecycle audited via outbox + COMPLIANCE notifications);
  `GET /api/export?entity=…&format=json|csv` (robots/orders/ledger/positions/
  traces, venue-labeled per B11, honesty meta); `GET /api/public/v1/{robots,
  orders,positions,ledger}` Bearer-authenticated, rate-limited 60 req/min per
  key (honest 429 naming the limit), venue labels on every row.
- **P8.5 — P-07 compliance ops + retention.** `src/lib/compliance.ts` +
  `GET/POST /api/compliance`: four retention policies (ticks 90d, traces
  180d, notifications 30d, failed outbox 7d — bounded, clamped), dry counts
  preview, manual run (`RetentionRun` audit row + COMPLIANCE outbox event +
  notification). **Financial truth is NEVER pruned** — LedgerEntry, Order +
  OrderEvent, Fill, Position, ReconciliationEntry, RetentionRun are outside
  policy by construction and the run result carries the preserved list
  (smoke P8-6d asserts ledger/order counts unchanged across a run).
- **P8.6 — P-08 platform metrics.** `src/lib/metrics.ts` + `GET /api/metrics`
  + Settings card: robots by status/venue, orders/fills/fees 24h, per-venue
  sync freshness (all six venues, honest "never synced"), notification
  anti-storm accounting, outbox backlog + dispatch lag p50/p95, AI
  governance counters, API-key usage, retention runs. Null where the
  platform does not record a number — no invented precision (D-03).
- **P8.7 — Acceptance smoke.** `scripts/smoke_phase8.py`: SMOKE PASS
  (P8-1..P8-8, 45 checks, isolation-run, re-run PASS) — Azuro posture +
  mapping vectors + honest conformance SKIP, storm probe through the real
  taxonomy, key lifecycle + rate limit + public API, export JSON/CSV,
  retention with financial-truth preservation, metrics, B4 negative check;
  platform ends SAFE (pause off, paper-only). Regression re-runs:
  smoke_phase4 + smoke_phase5 PASS (isolated). Visual pass: four Settings
  cards + phase badge (badge → 8; Settings re-baseline documented).
- **Verification protocol:** `bunx tsc --noEmit` clean, `bun run lint` clean,
  `bun run db:push` applied (ApiKey + Notification anti-storm fields +
  RetentionRun — additive only), dev-server smoke of every new route
  (statuses asserted in the phase smoke).

**Non-goals for Phase 8 (kept):** NO billing code of any kind until the
founder approves B4 (docs/PRICING_B4.md §7 checklist) AND the beta exit bar
holds; P-01 organization schema waits with it; no Azuro registry flip without
recorded conformance fixtures; no Kalshi work (Phase 9); no ARMED live send
(founder authorization on the founder host).

### Phase 9 — Mobile + venue #6 (Kalshi) (DONE, 2026-11-18)

Mobile shell per C18 + store-policy re-check per target market; Kalshi
adapter (key-based credential kind, US-persons complement).

- **P9.1 — Kalshi adapter → LIVE (S-05 §3.2 [VERIFY] first).** Dated probes
  recorded BEFORE adapter work (2026-11-18, 04:50–04:52 UTC, from this
  sandbox): `/markets` 200 with live data, `/events` + `/markets/{ticker}/orderbook`
  + `/series/{ticker}` 200 with full field sets, `docs.kalshi.com` markdown
  contract index 200. The documented contract: public market data is
  UNAUTHENTICATED; trading auth is an asymmetric API key; the orderbook
  returns BIDS ONLY (asks derive from the binary complement). Implementation
  (`src/lib/venue/kalshi.ts`): open events (the events endpoint EXCLUDES
  multivariate events — the newest-1000 /markets page is dominated by
  auto-generated MVE combo legs, observed and recorded) → stratified event
  sample → per-event markets → binary/active/non-MVE/two-sided filter with
  complement sanity → ranked by the venue's own contract volume (SELECTION
  only — `volume_fp` is a contract count, so `volumeCents` stays an honest
  null, D-03) → series metadata (fee_type/fee_multiplier/category/settlement
  sources) → books best-effort (fail-closed depth). Registry flipped
  KALSHI → LIVE; robots run the full paper pipeline.
  *Acceptance: ≥20 Kalshi markets synced with fee bps + A-04 keys +
  resolution provenance; thin books refused by the armed min-touch rule with
  the measured depth stated.* — **sandbox-verified 2026-11-18: 30 markets
  synced (all with depth + fees; categories: elections, sports, economics,
  climate, science, financials); thin-book manual ticket refused with the
  stated depth reason; live-mode flip for a Kalshi robot refused (live write
  exists only on POLYMARKET).**
- **P9.2 — Structural rules armed (config row in `src/lib/venue/rules.ts`).**
  Kalshi books are real central limit order books: rule (a) min-touch-depth
  $50 (the founder-calibrated Limitless number, fail-closed on missing
  books) + $500 per-market user-wide cap; NO close-time window (a regulated
  exchange with defined closes has no suspended-odds prematch window —
  contrast AZURO).
- **P9.3 — Fee schedule (C4.4 config, never hardcoded at call sites).**
  Documented quadratic schedule `fees = round_up(M × 0.07 × C × P × (1−P))`
  with the series' OWN `fee_multiplier` (e.g. KXELONMARS answered
  `{fee_type: "quadratic", fee_multiplier: 1}`; a 0-multiplier promo yields
  the venue's own 0 bps). Per-side bps at entry price p: M × 7 × (100 − p).
  Series lookup failure → the documented general schedule (M=1), never a
  made-up discount. Caught in-phase: the first implementation divided by 100
  twice — the smoke vector (350 bps @ 50¢ vs $1.75/100 contracts) caught it
  and the formula was fixed before close.
- **P9.4 — Second credential kind (carry-forward register: "RSA key auth ≠
  wallet signing").** `src/lib/live/kalshiCustody.ts`: asymmetric API key —
  RSA-2048 with RSA-PSS/SHA-256 (salt = digest length) or Ed25519 over
  `{timestamp_ms}{METHOD}{path}` (path from the API root, no query);
  headers KALSHI-ACCESS-KEY/-TIMESTAMP/-SIGNATURE. Same posture as S-08:
  env-injected per process (`KALSHI_API_KEY_ID` / `KALSHI_PRIVATE_KEY`),
  never stored (keyStored structurally false), every outbound string passes
  `redactKalshiKey()`. Proven OFFLINE by `scripts/kalshi_selftest.ts`
  (K1–K6 SELFTEST PASS: sign/verify round trips for both key types, pre-sign
  contract tamper checks, env-absent honest state, redaction, signature
  shape). Settings surfaces the credential kind honestly (custody card chip
  + live-control "Kalshi key cred" stat + /api/live `kalshiCred` — status
  only, never key material).
- **P9.5 — S-05 conformance fixtures RECORDED from the live feed.** Unlike
  Azuro (origin-blocked), the Kalshi API answers from this sandbox —
  `bun scripts/record-fixtures-kalshi.ts` captured 30 real markets + 9
  series + 30 books with a provenance manifest (`tests/fixtures/kalshi`);
  `bun run conformance:kalshi` replays the PURE mapping offline — 11/11
  PASS on 2026-11-18. That recorded-fixture pass is the registry-flip
  condition (S-05 §3.4) — satisfied, no self-approved flip.
- **P9.6 — Mobile shell per C18.** Installable PWA: `public/manifest.webmanifest`
  (standalone, themed icons 192/512/maskable generated from the brand mark,
  apple-touch-icon), `viewport` export (device-width, `viewportFit: cover`,
  theme-color) in `src/app/layout.tsx`. The phone carries no sidebar: a fixed
  bottom tab bar (`md:hidden`, aria-labeled, safe-area padded
  `fd-safe-bottom`, ≥44px touch targets) mirrors the five sidebar views, and
  the header gains a compact brand+phase block; PAPER chip always reachable.
  Tables go responsive: venue workspace and Markets hide TOUCH/PARITY/
  VOLUME below `sm` and SOURCE below `md` instead of overflowing at 390px.
  Verified with a 390×844 touch viewport (`scripts/shoot-phase9.ts`):
  dashboard, Kalshi workspace, markets, desktop custody card.
- **P9.7 — Store-policy re-check per target market (C18).**
  `docs/STORE_POLICY_PHASE9.md`: engineering-level re-check table (US / EU /
  rest-of-world matrix-allowed), dated sources, honest [VERIFY] counsel rows,
  re-check cadence. Decision: **web/PWA distribution only — no native store
  shells are built or submitted**; a store-channel change requires counsel
  sign-off on the [VERIFY] rows AND a founder decision (no self-approval).
- **Verification protocol:** `bunx tsc --noEmit` clean, `bun run lint` clean
  (no db:push needed — no schema changes), acceptance smoke
  `scripts/smoke_phase9.py` SMOKE PASS (P9-1..P9-8, isolation-run + re-run):
  posture, mapping vectors, recorded-fixture conformance + azuro honest SKIP,
  credential kind + no-PEM negative scans, live sync + freshness, paper fill
  on a Kalshi market + write-path negatives, mobile shell HTML/manifest/
  icons, store-policy doc, platform ends SAFE. Regression re-runs:
  smoke_phase4 PASS, smoke_phase5 PASS (isolated; one transient first-run
  warm-up failure after the reseed passed on the isolated re-run).

**Non-goals for Phase 9 (kept):** no Kalshi write path (the credential kind
exists; a live order path would require the B10 gates + founder authorization
on the founder host, same as Polymarket); no billing code (B4 still awaiting
founder approval); no native store shells (C18 store-policy doc); no
multivariate/combo positions (recorded mapping scope); Azuro stays PENDING
until its fixtures are recorded from an unblocked vantage.


### Phase 10 — Beta operations readiness (DONE, 2026-11-18)

The numbered roadmap ended at Phase 9; the declared next step (BETA_PHASE75
round 1) is gated on founder-host readiness, but running round 1 also needs
platform instruments the sandbox CAN build — none of this crosses a founder
gate (no billing, no live send, no Azuro flip, no push):

- **P10.1 — Session auth core (the cohort's front door).** `Session` model +
  `src/lib/auth.ts`: scrypt password hashing (node:crypto, per-user salt,
  constant-time verify), session tokens = 32 random bytes stored ONLY as
  SHA-256 (the P-06 ApiKey pattern), httpOnly cookie, 14-day expiry.
  `resolveAuth()`: session wins; else FOUNDER_FALLBACK (seeded OPERATOR) so
  every pre-Phase-10 surface and smoke behaves unchanged — disabled by
  `BETA_STRICT_AUTH=1` on the beta instance; the mode is always disclosed
  (`/api/auth/me` → via + strictAuth, D-03). Roles: OPERATOR | MEMBER; the
  fallback can never resolve a MEMBER. Password login rate-limited 10/min per
  IP+email (honest 429). One-time operator bootstrap (`/api/auth/bootstrap`)
  refuses once set — no shipped default password. Login/register/bootstrap
  pages on-brand and minimal.
- **P10.2 — Closed-beta registration gates (fail-closed at every step).**
  Password policy ≥10 chars → C4.5 eligibility via the live matrix (unknown
  country DENIES, sanctioned source surfaced) → enrollment must exist, active,
  unconsumed (no public signup, BETA §1). Registration links the account to
  the BetaMember row and notifies the operator (SYSTEM/INFO).
- **P10.3 — Route migration + ownership.** Every user-scoped API resolved the
  hardcoded founder; now request-scoped via resolveAuth with per-robot
  ownership (members act on their own robots only — PATCH/live-ticket/
  backtests; 404-not-403 on foreign backtest reads: no existence leak).
  Operator-only surfaces: compliance, metrics, control (kill switch — B8),
  eligibility PUT, consent record/revoke, probability POST, markets sync,
  cycle, live GET/pilot actions; REGISTER_WALLET stays session-scoped (member
  onboarding, B1 address-only). Orders/dashboard/export robots scoping fixed
  (previously unscoped reads would have leaked across members).
- **P10.4 — Beta ops API.** `/api/beta/cohort` (operator enrollment ≤25 cap,
  track mix accounting per §1), `/api/beta/defects` (the S0–S3 ladder as DATA
  — §3 definitions/responses verbatim in the API and UI; S0 fires an UNCAPPED
  CRITICAL RISK notification = §3 "STOP the round"), `/api/beta/feedback`
  (member submit / operator triage NEW→TRIAGED→DONE, member scope OWN),
  `/api/beta/round-snapshot` (R-0: health, open defects by severity, cohort
  mix, exit-bar item-8 signal, drill/smoke stamps), `/api/beta/exit-bar` (the
  8 §4 items MEASURED — items 1/2/8 computed from tables, 3/4 from PASS-stamp
  control keys written by the drill/smoke scripts via
  `/api/beta/drill-marker`, items 5/6/7 honest `FOUNDER_HOST` — never faked),
  `RobotSession` recorded INSIDE the robot-create transaction (atomic with the
  robot — same chaos-fix discipline; item 8 is measured, not estimated).
- **P10.5 — UI.** Beta Ops view: operator instruments (snapshot stats, exit
  bar with status tones, defect ladder + record form, cohort table + enroll,
  feedback inbox + triage) and a member panel (own progress vs the ≥3-sessions
  /≥1-feedback bar, feedback form + own items); identity chip + logout in the
  header; mobile tab bar carries Beta Ops (C18 continuity); badge → 10.
- **In-phase catches (recorded in BetaDefect + fixed same-phase):**
  1. `app.tsx` markets-state declaration was corrupted at source
     (`const [markets` partially eaten) and had passed tsc/lint since Phase
     7.5 via silent parser recovery — SWC even emitted invalid JS for one
     variant. Fixed; smoke P10-10d asserts the correct declaration.
  2. The documented SQLite concurrency posture (DECISIONS.md "SQLite
     concurrency posture", RUNBOOKS R1 startup check) had regressed in this
     sandbox: journal_mode back to `delete`, `.env` lost
     `?connection_limit=1&pool_timeout=120` → the B5 load 500'd (P2028
     socket-timeout quantization, exactly the runbook's warned failure mode).
     Re-applied; tx probe W=6: 10.0s→14ms; B5 seed 24/24, p95 ≤750ms PASS.
  3. Stale assertions: smoke_phase8 P8-1d (3 venues → 4 per Phase 9),
     smoke_phase9 P9-8c (badge 9 → 10), kill_switch_drill K4 (notification
     family SYSTEM → EXECUTION per the Phase 8 taxonomy),
     drill_phase75 R4 (market selection now depth-qualified — the armed
     touch-depth rule refused the previously-picked thin book).
- **Verification protocol:** tsc + lint clean; db:push applied (Session,
  BetaMember, RobotSession, BetaDefect, BetaFeedback, User.role/passwordHash
  — additive only); smoke `scripts/smoke_phase10.py` SMOKE PASS (40 checks,
  isolation-run + re-run): auth posture, lifecycle, registration gates, cohort,
  member isolation, robot sessions, defect ladder, exit bar + snapshot,
  feedback, closeout SAFE + no billing markers. Regressions re-run isolated:
  phase4 PASS, phase5 PASS, phase8 PASS (P8-1d updated), phase9 PASS (P9-8c
  updated), phase75 PASS (K4/R4 updated; B5 green on the restored posture).
  Screenshots: desktop Beta Ops + exit bar, login, register, mobile dashboard
  + mobile Beta Ops (`scripts/shoot-phase10.ts`).

**Non-goals for Phase 10 (kept):** no billing code (B4 pending); no live-send
arming; no Azuro registry flip; no public signup; no email verification
infrastructure (closed cohort — operator enrolls by email first); no OAuth/SSO
(scrypt+session is proportionate for ≤25 accounts; revisited if the platform
multi-tenants). Strict-mode machine-to-machine note: with BETA_STRICT_AUTH=1
external schedulers hitting /api/cycle get 401 — the beta instance runs the
in-process autopilot instead (documented here, not silently assumed).

**Phase 11 — UI redesign ratification (2026-11-18, in flight).** The founder
supplied a redesign artifact ("FAIDA Predict Redesign": Overview, Venue
workspace, Robot detail, Venue color system — hues identical to B12, neutrals
rescaled to #0B0E14→#E6EAF2, type stack Inter / Space Grotesk / JetBrains
Mono). Review verdict: direction ratified. Artifact defects found in render
and fixed in implementation, not carried over: template whitespace collapse
("Open{{venue}}workspace"), ragged net-edge wraps, header-only Volume column,
full sidebar stacked above content on phones, one blank stray artboard.
Implemented (overview first, per agreement): neutral rescale across the brand
layer; type stack via next/font (`--font-inter`, `--font-space-grotesk` as
`font-display`, `--font-jetbrains` mono); Overview rebuilt — greeting header
(hydration-safe clock via useSyncExternalStore), KPI band with the segmented
per-venue exposure bar, compact venue tile row (replaces the 2×3 card grid),
robots table (alloc + open/max + paper-mark open P&L, sorted), Decision feed
with venue-hued bars reusing the shared A-08 trace expansion; persistent
header exposure meter (xl chip + sm–md compact) so the 40% discipline is
answerable from every view; sidebar gains the venue list and the Mode panel
with the always-reachable "Pause everything" kill switch (same C19 control).
Verification: tsc + lint clean; dev compile clean; browser-verified desktop
(1440) + mobile (390) with live seeded data, venue-tile/sidebar/robot
navigation into the workspace, feed expansion showing provenance envelope +
pre-trade risk checks. Non-goals this pass: Venue workspace and Robot-detail
restyle (views keep the rescaled tokens only), Beta Ops screens unchanged;
search is still decorative (⌘K surface exists, command palette owed later).

## 5. Carry-forward register (must never be lost)

These are scheduled spec obligations that no phase may silently drop:

| Item | Obligation | When |
|------|-----------|------|
| S-05 conformance catalogue | Every new venue: catalog row + [VERIFY] check + contract tests + fee schedule | With each venue adapter (P3.1, 4, 6, 8, 9) — **Azuro executed 2026-11-18 (Phase 8): [VERIFY] evidence dated BEFORE adapter work; conformance fixtures owed from an unblocked vantage before the registry flips. Kalshi executed 2026-11-18 (Phase 9): [VERIFY] evidence dated BEFORE adapter work AND fixtures recorded from the live feed from the sandbox — the recorded-fixture flip condition is SATISFIED (registry LIVE)** |
| C19.1 kill-switch drill | Scheduled operational drill, not just a feature | **Executed 2026-11-18 (rehearsal DRILL PASS, §4 Phase 7); re-executed on the 7.5 cadence (smoke P75-5); monthly + per beta round from 7.5** |
| S-08 custody rubric | Rubric results recorded in DECISIONS.md before live signing | **Recorded 2026-11-18** (rubric verdict + S1–S6 self-test in DECISIONS.md) |
| B3 [VERIFY] rows | Counsel sign-off on geo/restriction entries | Rehearsal sign-off only (smoke P7-13, resets on exit) — **real counsel sign-off owed before the live pilot** |
| B5 operational targets | Freshness 5 s (live), decision latency 750 ms p95 [VERIFY], 500 concurrent robots, availability 99.5% | Live book budget landed + measured in P7-9; **latency p95 + load measured in 7.5 (P75.4): 500 robots, p95 699 ms @ 16-way, 100% availability — sandbox numbers; founder-host production re-run owed before the live pilot scales** |
| A-04 clustering | Related-market exposure stacking | **Landed in Phase 4** (`eventKey` stacking in `src/lib/risk.ts`; re-check for every new venue adapter) |
| D-03 honesty badges | SYNTHETIC vs LIVE labeling everywhere evidence is shown | Standing rule, every phase |
| P-01 organizations | Data model early, feature later | Model when billing lands (Phase 8) — **billing stays unwritten pending founder B4 approval + beta exit bar (Phase 8 ledger, P8.1); P-01 waits with it** |
| R-01 B5 defaults | Founder numbers recorded in DECISIONS.md | Confirmed via B5; **7.5 stress pass recorded (32-way lockstep burst p95 977 ms — capacity holds, latency budget needs paced scheduling); revisit at the live pilot** |
| B4 pricing | Engineering draft approved by founder **before** billing code exists | **Drafted 2026-11-18 (`docs/PRICING_B4.md`, §7 approval checklist) — founder approval owed; no billing code exists (smoke-asserted)** |
| C18 store-policy re-check | Per target market before any native distribution | **Recorded 2026-11-18 (Phase 9)** — `docs/STORE_POLICY_PHASE9.md`: web/PWA only, [VERIFY] counsel rows owed before any store channel; re-check cadence documented |
| Kalshi credential kind | RSA key auth ≠ wallet signing — adapter + settings must support it | **Recorded 2026-11-18 (Phase 9)** — asymmetric API key (RSA-PSS/SHA-256 or Ed25519) implemented env-injected + never stored (`src/lib/live/kalshiCustody.ts`), proven offline (selftest K1–K6), surfaced in Settings + /api/live |
| Push discipline | Local commits are not delivered until the founder provides a fresh fine-grained PAT | Every handoff — status 2026-11-18: tree clean, all commits through Phase 10 delivered to GitHub |

## 6. Hard invariants (repeat verbatim at every code review)

1. Money is integer cents — floats never touch amounts (S-09).
2. UNKNOWN orders resolve only via reconciliation evidence (S-01/S-04).
3. Platform never stores wallet private keys (B1).
4. Sanctioned jurisdictions can never be allowed (C4.5).
5. Live order placement refuses until the Phase 7 gates pass + explicit
   authorization (B10); the DRY-RUN send armor keeps transmission off until
   the founder arms it.
6. Every order records the strategy version that produced it (C5).
7. Backtests are evidence, never promises: adverse slippage, fees, honest labels (A-05/D-03).
8. Every robot, market, order, position and trace names its venue (B11).

## 7. Verification protocol (every milestone)

1. `bun run typecheck` (excluding `examples/`, `skills/`) and `bun run lint` — both clean.
2. `bun run db:push` after schema changes; reseed when the seed gains content.
3. Dev-server smoke of the new API surface (exact routes exercised, status codes checked).
4. Screenshot every touched view; venue naming must be visible where relevant (B11).
5. `DECISIONS.md` updated when a founder decision is made or a checkpoint lands.
6. Conventional commit message; keep the working tree clean at handoff.
7. Nothing in this file may be left un-ticked while its phase is called done.

## 8. Open founder inputs

- **Fresh fine-grained PAT** to push commits (Phases 3–10) to
  `maiwand-ai/faida-predict` — **DELIVERED 2026-11-18.** All commits through
  Phase 10 (`7318130`) are on GitHub `main` (verified via `ls-remote`); the
  Phase 10 commit itself carried the "push pending" note because it could
  only be delivered by the very push it described — this bookkeeping commit
  corrects that record and is delivered by the fresh PAT the founder
  supplied for exactly this purpose. First push attempt with that token
  (2026-11-18) was refused 403 — the token authenticated as `maiwand-ai` but
  lacked write scope (fine-grained PATs need Repository access =
  `maiwand-ai/faida-predict` AND Permissions → Contents: Read and write); a
  replacement token with that scope delivers it. Standing rules unchanged:
  tokens are
  injected per-process only, never stored, and revoked after use; every
  future handoff re-requests a fresh PAT.
- **B4 pricing approval** — `docs/PRICING_B4.md` §7 checklist (tiers, overage
  policy, dunning ladder, refunds, implementation order). Billing code stays
  unwritten until approved AND the beta exit bar holds.
- **Azuro unblock** — UPDATED by the 2026-11-18 full-app review: the adapter's
  API base (`api.onchainfeed.org/api/v1/public`) answers from a reachable
  network but EVERY path including the root returns nginx 404 — the endpoint
  the Phase 8 adapter was built against is dead, so fixture recording would
  fail on ANY host until the adapter is re-pointed to the current Azuro
  Backend API (developer-hub documented; S-05 obligations apply to the
  re-point: [VERIFY] evidence, fee schedule, contract tests). THEN run
  `bun scripts/record-fixtures-azuro.ts` and `bun run conformance:azuro`
  from any vantage that reaches the new API; a recorded-fixture pass is the
  registry-flip condition (S-05 §3.4; no self-approved flip).
- **Stale `phase-3` branch on GitHub** — `refs/heads/phase-3` (b9eac84) is
  fully merged into main; delete it with the next working PAT:
  `git push origin --delete phase-3`.
- Full 72-hour soak (P3.5 acceptance) runs on the founder's host — the
  sandbox runs the shortened variant.

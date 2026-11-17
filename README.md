# FAIDA Predict — Phase 3 (autonomy, Manifold harness, safety layer)

Autonomous prediction-market trading platform — paper-mode core with the full
trust architecture from the specification review brief. **All execution is
paper; live trading is disabled by contract until the Phase 7 gates pass.**

Planning source of truth: `docs/DEVELOPMENT_PLAN.md` (venue contracts, phase
ledger, carry-forward register). Decisions: `DECISIONS.md`.

## What is working

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
  (Polymarket primary · Manifold harness · Limitless / Drift BET / Azuro /
  Kalshi fast-follows); robots are scoped to exactly one venue; every market,
  order, robot card, trace and ticket names its venue; wizard step 1 is a
  venue picker that only allows live adapters.
- **Polymarket adapter (LIVE market data)** — Gamma API, public, read-only,
  BigInt-safe.
- **Manifold adapter (LIVE market data, Phase 3)** — play-money harness via
  public REST; binary markets only; the full pipeline (sync → decision →
  paper fill → ledger → trace) runs on it with zero financial risk.
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
  with average cost, fee schedule from config.
- **Risk engine (C10/B5)** — two-tier config (platform ceilings + user
  limits, stricter-only), per-event exposure, mark-to-market daily loss stop.
- **Eligibility matrix (C4.5)** — editable per-country allow/block with a hard
  sanction-list invariant; default-deny for unknown countries.
- **AI gateway (A-06)** — provider-agnostic: GLM (keyless via SDK), OpenAI,
  Anthropic, any OpenAI-compatible base URL. Heuristic estimator fallback.
- **Decision traces (A-08)** — every robot decision, trade or no-trade, with
  model estimate, edge and all risk checks — config-driven per version.
- **UI** — brand-blue shell: Overview (+ **platform control card**), Markets
  (one section per venue with per-venue sync), Robot Studio (wizard +
  **Strategy Lab**), Trading (ticket + orders + ledger + reconciliation
  drill), Settings (risk, AI providers, dispatcher status, eligibility).

## Run locally

```bash
bun install
bun run db:push
bun prisma/seed.ts
bun run dev          # http://localhost:3000
```

## Try the trust machinery

1. **Overview → Run robot cycle** — robots evaluate markets **on their own
   venue** and trade or refuse with stated reasons (stale data, edge, risk).
2. **Overview → Platform control** — press **Start autopilot** (pick 60/120/
   300 s) and watch cycles run without clicks; **Global pause** refuses
   everything (cycles and manual tickets) until **Resume**.
3. **Markets → Sync Polymarket / Sync Manifold** — per-venue adapters pull
   live markets and append price ticks to the A-05 recorder.
4. **Trading → Simulate lost venue ack → UNKNOWN**, then **Run reconciliation
   pass** — the order resolves REJECTED with evidence, and the drift entry
   closes — never by hope.
5. **Robot Studio → Strategy Lab** — save the sliders as an immutable v2,
   activate it, then **Run backtest**: stats, equity curve and the
   SYNTHETIC/LIVE honesty badge.
6. **Soak** — `bun scripts/soak.ts --duration-min 72 --interval-sec 60`
   against a running instance; the verdict lands in `soak-report.json`.
7. **Settings** — flip an eligibility country (IR refuses); paste any LLM
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

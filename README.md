# FAIDA Predict — Phase 2 (strategy versioning, backtests, email dispatch)

Autonomous prediction-market trading platform — paper-mode core with the full
trust architecture from the specification review brief. **All execution is
paper; live trading is disabled by contract until the Phase 7 gates pass.**

## What is working

- **Order state machine (S-01)** — CREATED → VALIDATED → SUBMITTED → FILLED,
  with RECONCILING/UNKNOWN states that only reconciliation evidence can resolve.
  Every transition is journaled (`OrderEvent`).
- **Transactional outbox (S-02)** — events written in the same transaction as
  state changes, drained to the notification feed **and paged by email via
  Resend** (best-effort, per-event `emailStatus`, throttled, honest NO_KEY state).
- **Idempotency keys (S-03)** — same economic input + nonce = same order, never
  a duplicate.
- **Strategy versioning (C5)** — versions are immutable; the lab saves new
  versions from sliders, activation is a pointer move (status untouched), and
  every order/trace records the exact `strategyVersionId` that produced it.
- **Backtest engine (A-05)** — deterministic replay of a strategy version over
  recorded `MarketPriceTick` history with the conservative fill model: adverse
  slippage per side, fee schedule in bps, 5%-of-liquidity guard. Stats (win
  rate, PnL, ROI, max drawdown, avg entry edge) + equity curve, honestly
  labeled SYNTHETIC vs LIVE (D-03).
- **Price recorder** — every market sync and every robot cycle appends ticks;
  the seed writes clearly-labeled SYNTHETIC history so backtests work
  immediately.
- **Paper trading engine (P-02)** — append-only virtual ledger, positions with
  average cost, fee schedule from config.
- **Risk engine (C10/B5)** — two-tier config (platform ceilings + user limits,
  stricter-only), per-event exposure, mark-to-market daily loss stop.
- **Eligibility matrix (C4.5)** — editable per-country allow/block with a hard
  sanction-list invariant; default-deny for unknown countries.
- **Live market data** — Polymarket Gamma adapter (public, read-only, BigInt-safe).
- **AI gateway (A-06)** — provider-agnostic: GLM (keyless via SDK), OpenAI,
  Anthropic, any OpenAI-compatible base URL. Heuristic estimator fallback.
- **Decision traces (A-08)** — every robot decision, trade or no-trade, with
  model estimate, edge and all risk checks — now config-driven per version.
- **UI** — brand-blue shell: Overview, Markets, Robot Studio (wizard +
  **Strategy Lab**), Trading (ticket + orders + ledger + reconciliation drill),
  Settings (risk, AI providers, **dispatcher status**, eligibility).

## Run locally

```bash
bun install
bun run db:push
bun prisma/seed.ts
bun run dev          # http://localhost:3000
```

## Try the trust machinery

1. **Overview → Run robot cycle** — robots evaluate the top live market and
   trade or refuse with stated reasons (entry rule comes from their active
   strategy version).
2. **Markets → Sync from Polymarket** — pulls live markets and appends price
   ticks to the A-05 recorder.
3. **Trading → Simulate lost venue ack → UNKNOWN**, then **Run reconciliation
   pass** — watch the order resolve REJECTED with evidence, never by hope.
4. **Robot Studio → Strategy Lab** — save the sliders as an immutable v2,
   activate it, then **Run backtest**: stats, equity curve and the SYNTHETIC/
   LIVE honesty badge.
5. **Settings** — flip an eligibility country; try flipping IR (refused);
   paste any LLM key; tighten a risk limit (clamped to the platform max);
   read the dispatcher card (Resend status, 24h email counts).

## API surface (all JSON)

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/health` | GET | liveness + mode |
| `/api/dashboard` | GET | aggregated overview |
| `/api/markets` | GET, POST | cached list / live sync (appends ticks) |
| `/api/robots` | GET, POST, PATCH | list, create (PAPER_ONLY), status transitions |
| `/api/strategies` | GET, POST, PATCH | version lineage, create immutable version, activate |
| `/api/backtests` | GET, POST | list/read runs, replay a version over ticks |
| `/api/orders` | GET, POST | list+ledger, place paper order, ack-loss drill |
| `/api/cycle` | POST | robot evaluation tick / reconciliation pass |
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
route.

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

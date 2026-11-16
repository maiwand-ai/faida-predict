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
| B9 | Venue #2 | Manifold (play-money) as pre-edge-gate test harness; then Limitless or Kalshi | ROADMAP | Adapter interface ready; no code yet |
| B10 | Live money gates | Edge gate + backtest (A-05 fill-model) + paper session + recorded consent (C25) before any live order | RATIFIED | `placeOrder()` on the live adapter throws by contract |

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

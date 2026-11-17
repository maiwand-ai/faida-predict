# B4 — Pricing draft (engineering proposal, Phase 8)

> **STATUS: DRAFT — AWAITING FOUNDER APPROVAL.** Per DECISIONS.md B4 and
> DEVELOPMENT_PLAN.md §8: *the founder approves pricing before any billing
> code exists.* This document is the engineering draft only. **No billing
> code, no payment provider, no entitlement enforcement from billing, and no
> P-01 organization schema has been written** — the beta exit bar
> (BETA_PHASE75.md §4) also gates billing: commercialization never starts on
> top of an open S0/S1.
>
> When the founder approves (with edits), the implementation order is:
> entitlement snapshots → P-01 organization data model → dunning → refunds
> (P-05), each with its own phase-smoke coverage. Nothing in this doc binds
> until that approval is recorded in DECISIONS.md.

Drafted: 2026-11-18 · Author: engineering (autonomous run, founder-directed
Phase 8) · Ratification target: DECISIONS.md B4 row.

## 1. Design constraints (ratified inputs this draft must respect)

| Constraint | Source | How the draft respects it |
|---|---|---|
| Free/Pro/Professional shape with AI-credit allowances | B4 | Three tiers, credits expressed in AI calls/month mapped to `AI_MONTHLY_BUDGET_CENTS` |
| Users may only be STRICTER than platform ceilings | B5 | Paid tiers never raise risk ceilings — they raise *operational* allowances (robots, seats, credits), never B5 risk maximums |
| Paper-first, gated live | B10/C25 | Live-pilot access is a Phase-7-gated product surface; pricing grants *eligibility*, never a bypass |
| Venue lineup and per-venue honesty | B9/S-05 | Tiers do not promise venues; adapter availability is a platform fact, not a paid feature |
| Data honesty D-03 | Standing | Entitlement changes are snapshotted + audited; every surface shows the tier that produced a number |
| Self-host single-tenant today | Architecture | Entitlements are enforced per-user rows; billing provider is pluggable (see §6) |

## 2. Tier definitions (the draft the founder is asked to approve)

| | **Free** | **Pro** | **Professional** |
|---|---|---|---|
| **Price** (monthly, ex-VAT) | €0 | €19 | €79 |
| **Annual** | — | €190 (2 months free) | €790 (2 months free) |
| **Robots** (concurrently active) | 2 | 10 | 40 |
| **AI research credits** (calls/month, deterministic fallback unmetered) | 150 | 1,000 | 5,000 |
| **AI monthly budget ceiling** (maps to `AI_MONTHLY_BUDGET_CENTS`) | $25 | $100 | $200 (= platform ceiling, B5) |
| **Backtests / month** | 30 | 300 | 2,000 |
| **Read-only API keys (P-06)** | 1 key, 60 req/min | 5 keys, 120 req/min | 25 keys, 600 req/min |
| **Data export (P-06)** | JSON/CSV | JSON/CSV + scheduled monthly | JSON/CSV + scheduled monthly + full traces |
| **Notification channels (P-04)** | in-app feed | + email fan-out | + email + webhook (digest) |
| **Live-pilot eligibility (Phase 7 gates)** | not eligible | eligible — gates + consent still apply | eligible — gates + consent still apply |
| **Venues** | all LIVE venues (paper) | all LIVE venues | all LIVE venues |
| **Support** | community docs | email, 2 business days | email, 1 business day |

Notes:
- **AI credits ≠ dollars.** Credits meter *research calls* (A-07 governance
  already logs every call). The dollar budget (`AI_MONTHLY_BUDGET_CENTS`)
  stays the two-tier risk control (B5) — pricing changes the *allowance the
  user may set*, never the platform ceiling.
- **Deterministic fallback is unmetered** on every tier (B7): a user without
  AI budget still has a working robot — the baseline heuristic never costs
  money, so no tier can break risk management by running out of credits.
- **Free tier keeps the full trust architecture.** We do not paywall safety:
  kill switch, reconciliation, ledger, traces, eligibility are identical on
  all tiers (the product IS the trust architecture — §1 of the plan).
- **Live-pilot eligibility** means the *mode flip UI* becomes available; the
  actual live path still requires the B10 gate stack + recorded consent +
  founder-armed posture. A tier never relaxes a gate.

## 3. Entitlement snapshots (the implementation contract, written at approval)

- `Entitlement` rows keyed by userId with `{ tier, robots, aiCredits, ... }`,
  written on checkout/upgrade and **snapshotted onto every billing-relevant
  event** (robot create, backtest run, AI call) exactly the way orders
  snapshot `strategyVersionId` (C5 pattern) — an entitlement change never
  rewrites history.
- Enforcement points (each returns a named, honest refusal — D-04):
  robot create (`ROBOT_LIMIT`), backtest run (`BACKTEST_LIMIT`), AI gateway
  pre-call (`AI_CREDITS`), API-key issue (`KEY_LIMIT`), public API rate limit
  (`RATE_LIMIT`), live-pilot flip (`TIER_LIVE_ELIGIBILITY`).
- Every refusal names the tier and the current usage; the UI renders it
  verbatim next to the action.
- Overage policy: hard-stop with refusal (never silent degradation, never
  surprise overage billing) — the user must act. Digest notifications
  (P-04) announce 80%/100% credit usage.

## 4. Dunning (design only — no code until approval)

| Event | Timing | Action |
|---|---|---|
| Renewal attempt fails | day 0 | `BILLING` family notification (P-04 taxonomy, capped 4/h) + email |
| Retry 1 | day 3 | automatic retry; in-app banner |
| Retry 2 | day 7 | automatic retry; robot creation locked (existing robots keep running — we do not orphan running paper robots mid-cycle) |
| Grace ends | day 14 | tier downgrades to Free entitlements at the next snapshot; **no data is deleted**, ledger/robots preserved; re-upgrade restores instantly |
| Final | day 30 | account flagged `BILLING_FINAL`; API keys revoked (P-06 surface), export stays available (data belongs to the user) |

Dunning state machine mirrors the S-01 discipline: every transition journaled,
`UNKNOWN` payment states resolve only via provider evidence (webhook), never
optimistically.

## 5. Refunds & proration (P-05, policy for founder sign-off)

- **14-day money-back** on first Pro/Professional charge (self-serve, no
  questions; EU right-of-withdrawal honored — [VERIFY] exact withdrawal-form
  requirements with counsel before launch).
- **Proration on upgrade**: immediate, charged pro-rata for the remaining
  term. **Downgrade**: takes effect at period end (no mid-term refunds except
  the 14-day window and statutory cases).
- **Chargebacks**: account pauses (C19-style, reason recorded) until
  resolved — consistent with the kill-switch philosophy.
- Taxes: VAT/OSS handling is a [VERIFY] row for counsel/accountant — the
  engineering draft does not assume a provider-specific tax feature.

## 6. Provider posture (engineering note — decision at approval time)

- Billing provider is **pluggable behind one interface** (`BillingProvider`:
  checkout, subscription state, webhook verification) so the founder can
  choose Stripe / Paddle / Lemon Squeezy (merchant-of-record providers
  offload VAT — relevant to the [VERIFY] tax row) without reworking
  entitlements. Entitlement snapshots are provider-agnostic by design.
- Webhooks verify signatures; replay protection via idempotency keys (S-03
  composition reused); every webhook writes an outbox event before any state
  change (S-02 discipline).
- **No billing code exists in the repo today** — verified by the phase smoke
  (negative check for payment SDK imports).

## 7. What the founder is approving (checklist for the ratification reply)

1. The three tiers and their numbers (§2) — or the edits to them.
2. Hard-stop overage (§3) — no surprise billing.
3. The dunning ladder (§4) — 14-day grace, no data deletion.
4. Refunds/proration policy (§5) — 14-day money-back, [VERIFY] tax row.
5. Implementation order (§ header): entitlements → P-01 orgs → dunning →
   refunds, gated by the beta exit bar holding.

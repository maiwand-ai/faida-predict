# C18 store-policy re-check — Phase 9 (2026-11-18)

C18 requires the mobile experience to ship as a shell whose distribution
channel is re-checked against app-store policy **per target market** before
any native distribution is attempted. This is the engineering-level re-check
recorded at Phase 9; it is NOT legal advice, and the [VERIFY] rows below are
counsel work that stays owed before any store submission would ever be made.

## Decision (engineering posture)

**FAIDA Predict ships as a web app + installable PWA. No native store shells
(iOS/Android) are built or submitted in Phase 9.** The C18 mobile shell is:

- `public/manifest.webmanifest` (installable, standalone, themed icons)
- `viewport` export in `src/app/layout.tsx` (device-width, notch-safe
  `viewportFit: cover`, theme color)
- mobile bottom tab bar + mobile header in `src/components/faida/app.tsx`
  (`md:hidden` — phones carry no sidebar), safe-area padded (`fd-safe-bottom`)
- responsive markets table (PARITY/VOLUME hidden below `sm`, SOURCE below `md`)

Rationale: prediction-market real-money apps sit in the most policy-sensitive
app-store category, and every venue FAIDA aggregates (Polymarket, Kalshi,
Limitless, Azuro) carries a DIFFERENT regulatory shape per jurisdiction — an
app-store rejection or removal in one market must not take the platform
offline for every other market. A PWA keeps the distribution channel under the
platform's own control while the compliance surface (B3 eligibility matrix)
evolves with counsel.

## Per-market re-check table (engineering read, dated 2026-11-18)

| Target market | Channel | Policy posture (engineering read) | Action |
|---|---|---|---|
| United States | Web/PWA | App Store/Play real-money prediction markets are restricted: Apple rejected the US Polymarket app (Jan 2025) and removed Polymarket for US users; Google Play gambling policy requires an explicit gambling license per jurisdiction. Kalshi (CFTC-regulated DCM) ships native apps, but FAIDA aggregates MULTIPLE venues — the strictest venue's restriction wins for a shell that surfaces all of them. | Web/PWA only. Native shells NOT attempted. [VERIFY with counsel before any change] |
| European Union | Web/PWA | No per-store prediction-market carve-out that is stable across member states; consumer-protection and gambling-advertising rules vary by member state. FAIDA's eligibility matrix (B3, EU-first allow set) is the gating surface, not the store. | Web/PWA only. [VERIFY with counsel per member state before any change] |
| Rest of world (matrix-allowed) | Web/PWA | The eligibility matrix (B3) already default-denies unknown countries and hard-blocks sanctioned ones (C4.5). Store policies add nothing but risk here. | Web/PWA only. [VERIFY with counsel] |

## Re-check cadence

1. This table is re-checked **before any phase that changes distribution**
   (native shells, store listings, third-party app integrations) and **on any
   founder request** to enter a store channel.
2. Any store-channel change requires BOTH the counsel sign-off on the [VERIFY]
   rows AND a founder decision recorded in `DECISIONS.md` — no self-approval.
3. PWA capability is re-verified at every phase smoke that touches the shell
   (`scripts/smoke_phase9.py` asserts the manifest + viewport + mobile nav).

## Honest scope note

This document records an ENGINEERING re-check with dated sources; it is not a
legal opinion. The [VERIFY] rows are tracked in the carry-forward register
(`docs/DEVELOPMENT_PLAN.md` §5) alongside the B3 counsel rows, which gate the
live pilot — store policy and trading eligibility are separate surfaces, and
both need counsel before real-money reach expands.

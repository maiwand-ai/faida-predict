// Per-venue, per-country availability: "where can I use which market, with
// what, and how". Shared by the server (real-money enforcement) and the UI
// (Help centre, venue badges, robot creation). No database import here: the
// operator's overrides arrive as a plain object (PlatformControl
// VENUE_AVAILABILITY_OVERRIDES) and are merged in by the callers.
//
// Status meanings
//   OPEN        real money allowed (practice always allowed)
//   CHECK       sources disagree or the venue leaves it to the user — practice
//               allowed, real money locked until an operator confirms
//   CLOSE_ONLY  venue lets existing positions be closed, no new ones
//   BLOCKED     venue does not serve this country
//
// Research snapshot: 2026-11-24. Third-party lists conflict with each other
// and venues change their lists without notice, so every row carries its
// source and the date it was checked, and the UI always links the venue's
// own terms. This is guidance, not legal advice — counsel confirms before a
// real-money launch in any country.

export type AvailabilityStatus = "OPEN" | "CHECK" | "CLOSE_ONLY" | "BLOCKED";

export interface VenueGuide {
  venue: string;
  what: string;
  money: string;
  realMoney: boolean;
  connect: string[];
  fees: string;
  officialTerms: string;
  helpUrl: string;
  defaultStatus: AvailabilityStatus;
  defaultNote: string;
  rules: Record<string, { status: AvailabilityStatus; note: string }>;
  lastChecked: string;
  sources: string[];
}

export const LAST_CHECKED = "2026-11-24";

// Sanctioned jurisdictions: absolute everywhere, never overridable.
export const SANCTIONED: Record<string, string> = {
  IR: "Iran", KP: "North Korea", CU: "Cuba", SY: "Syria",
};

const sanctioned = Object.fromEntries(
  Object.keys(SANCTIONED).map((c) => [c, { status: "BLOCKED" as const, note: "Sanctioned jurisdiction (OFAC/EU). Not available on any venue." }]),
);
const rows = (status: AvailabilityStatus, note: string, codes: string[]) =>
  Object.fromEntries(codes.map((c) => [c, { status, note }]));

export const VENUE_GUIDES: VenueGuide[] = [
  {
    venue: "POLYMARKET",
    what: "The largest prediction market. Trade YES/NO shares on politics, crypto, sports and world events. Prices run from 1¢ to 99¢ and pay $1 if you're right.",
    money: "Real money: USDC (a dollar stablecoin) on the Polygon network, held in your own wallet.",
    realMoney: true,
    connect: [
      "Create a Polymarket account and fund it with USDC on Polygon.",
      "In FAIDA Predict, open Settings › Wallet and connect your wallet address.",
      "Record your consent in Settings › Real-money permissions; robots stay in practice until every safety check passes.",
    ],
    fees: "Most markets have no trading fee; some charge a small taker fee shown before each order.",
    officialTerms: "https://polymarket.com/tos",
    helpUrl: "https://docs.polymarket.com/",
    defaultStatus: "OPEN",
    defaultNote: "Not on Polymarket's known restriction lists. Confirm in Polymarket's own terms before trading.",
    rules: {
      ...sanctioned,
      ...rows("BLOCKED", "Restricted by Polymarket's international platform. A separate US app exists under US regulation; FAIDA does not connect to it yet.", ["US"]),
      ...rows("BLOCKED", "Listed as restricted by Polymarket across sources.", ["FR", "BE", "SG", "TH", "TW"]),
      ...rows("CHECK", "Sources disagree (close-only vs. blocked vs. open). Check Polymarket's help centre for your country.", ["GB", "DE", "AU", "BR", "PL", "PT", "HU", "CH", "IT", "CA"]),
      ...rows("BLOCKED", "Occupied regions (Crimea, Donetsk, Luhansk) are fully blocked; check the rest of the country with Polymarket.", ["RU", "BY"]),
    },
    lastChecked: LAST_CHECKED,
    sources: [
      "https://polymarket.com/tos",
      "https://airdropalert.com/blogs/polymarket-restricted-countries/",
      "https://polymarket.review/countries/",
      "https://librepass.co/learn/polymarket-geoblock/",
    ],
  },
  {
    venue: "KALSHI",
    what: "A US-regulated exchange (CFTC) for event contracts: economics, politics, weather, sports. Opened to members outside the US in October 2025.",
    money: "Real money in US dollars, held at Kalshi.",
    realMoney: true,
    connect: [
      "Open a verified Kalshi account (identity check required).",
      "Create an API key in Kalshi's account settings.",
      "Add the key in FAIDA Predict when Kalshi real-money trading opens; today FAIDA trades Kalshi with practice money only.",
    ],
    fees: "A small fee per contract, highest near 50¢ and lower near 1¢ or 99¢, shown before each order.",
    officialTerms: "https://help.kalshi.com/en/",
    helpUrl: "https://help.kalshi.com/",
    defaultStatus: "OPEN",
    defaultNote: "Kalshi accepts members from roughly 140 countries. Confirm your country in Kalshi's help centre (Member Agreement).",
    rules: {
      ...sanctioned,
      ...rows("OPEN", "Kalshi's home market, regulated by the CFTC. Some states restrict sports contracts.", ["US"]),
      ...rows("BLOCKED", "On Kalshi's restricted-jurisdictions list.", [
        "GB", "FR", "IT", "IE", "BE", "PL", "PT", "HU", "BG", "CH", "MC", "RU", "BY", "UA",
        "CA", "BO", "HT", "NI", "VE",
        "AU", "IN", "NZ", "SG", "CN", "TW",
        "AE", "DZ", "IQ", "LB", "LY", "YE",
      ]),
      ...rows("CHECK", "Reported inconsistently across sources. Check Kalshi's help centre (Member Agreement).", ["DE", "NL", "ES"]),
    },
    lastChecked: LAST_CHECKED,
    sources: [
      "https://help.kalshi.com/en/",
      "https://kalshiview.com/international/",
      "https://www.coinrithm.com/en/blog/kalshi-countries-and-availability",
    ],
  },
  {
    venue: "LIMITLESS",
    what: "A crypto prediction market on the Base network, known for fast short-term markets (e.g. where a coin's price will be in an hour).",
    money: "Real money: USDC on Base, held in your own wallet.",
    realMoney: true,
    connect: [
      "Fund a wallet with USDC on Base and sign in on Limitless.",
      "FAIDA trades Limitless with practice money today; real-money robots on Limitless come later.",
    ],
    fees: "Trading fees vary by market type and are shown before each order.",
    officialTerms: "https://docs.limitless.exchange/user-guide/terms-of-service",
    helpUrl: "https://docs.limitless.exchange/",
    defaultStatus: "CHECK",
    defaultNote: "Limitless's terms make you responsible for checking your own country. Read them before trading.",
    rules: {
      ...sanctioned,
      ...rows("BLOCKED", "Limitless's terms exclude US residents (a separate US entity has applied for CFTC approval).", ["US"]),
    },
    lastChecked: LAST_CHECKED,
    sources: ["https://coinstats.app/prediction-markets/apps/limitless/", "https://defirate.com/news/limitless-files-cftc-approval-after-record-1-66b-month/"],
  },
  {
    venue: "MANIFOLD",
    what: "A play-money prediction market. The perfect place to learn and to test robots: nothing you win or lose is real money.",
    money: "Play money (mana). It cannot be withdrawn as cash.",
    realMoney: false,
    connect: ["Nothing to connect: FAIDA reads Manifold's public markets, and robots trade them with practice money."],
    fees: "None.",
    officialTerms: "https://docs.manifold.markets/terms",
    helpUrl: "https://docs.manifold.markets/",
    defaultStatus: "OPEN",
    defaultNote: "Play money only, so it's available everywhere FAIDA is.",
    rules: { ...sanctioned },
    lastChecked: LAST_CHECKED,
    sources: ["https://docs.manifold.markets/terms"],
  },
];

export type AvailabilityOverrides = Record<string, Record<string, { status: AvailabilityStatus; note?: string; by?: string; at?: string }>>;

export interface Availability {
  venue: string;
  country: string;
  status: AvailabilityStatus;
  note: string;
  overridden: boolean;
  practice: boolean;
  realMoney: boolean;
}

/** Availability of one venue for one country, operator overrides applied. */
export function venueAvailability(venue: string, country: string, overrides: AvailabilityOverrides = {}): Availability {
  const c = (country || "").toUpperCase();
  const g = VENUE_GUIDES.find((x) => x.venue === venue);
  if (SANCTIONED[c]) {
    return { venue, country: c, status: "BLOCKED", note: "Sanctioned jurisdiction (OFAC/EU). Not available on any venue.", overridden: false, practice: false, realMoney: false };
  }
  if (!g) {
    return { venue, country: c, status: "BLOCKED", note: "This venue is not connected yet.", overridden: false, practice: false, realMoney: false };
  }
  const o = overrides[venue]?.[c];
  const base = g.rules[c] ?? { status: g.defaultStatus, note: g.defaultNote };
  const status = o?.status ?? base.status;
  const note = o ? (o.note || base.note) : base.note;
  return {
    venue,
    country: c,
    status,
    note,
    overridden: !!o,
    practice: true,
    realMoney: g.realMoney && status === "OPEN",
  };
}

export const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  OPEN: "Available",
  CHECK: "Check first",
  CLOSE_ONLY: "Close only",
  BLOCKED: "Not available",
};

// ISO country list for pickers (common prediction-market audiences first is
// not useful; alphabetical by name is what people scan).
export const COUNTRIES: Array<[string, string]> = [
  ["AF", "Afghanistan"], ["AL", "Albania"], ["DZ", "Algeria"], ["AR", "Argentina"], ["AM", "Armenia"], ["AU", "Australia"], ["AT", "Austria"],
  ["AZ", "Azerbaijan"], ["BH", "Bahrain"], ["BD", "Bangladesh"], ["BY", "Belarus"], ["BE", "Belgium"], ["BO", "Bolivia"], ["BA", "Bosnia and Herzegovina"],
  ["BR", "Brazil"], ["BG", "Bulgaria"], ["KH", "Cambodia"], ["CM", "Cameroon"], ["CA", "Canada"], ["CL", "Chile"], ["CN", "China"], ["CO", "Colombia"],
  ["CR", "Costa Rica"], ["HR", "Croatia"], ["CU", "Cuba"], ["CY", "Cyprus"], ["CZ", "Czechia"], ["DK", "Denmark"], ["DO", "Dominican Republic"],
  ["EC", "Ecuador"], ["EG", "Egypt"], ["SV", "El Salvador"], ["EE", "Estonia"], ["ET", "Ethiopia"], ["FI", "Finland"], ["FR", "France"], ["GE", "Georgia"],
  ["DE", "Germany"], ["GH", "Ghana"], ["GR", "Greece"], ["GT", "Guatemala"], ["HT", "Haiti"], ["HN", "Honduras"], ["HK", "Hong Kong"], ["HU", "Hungary"],
  ["IS", "Iceland"], ["IN", "India"], ["ID", "Indonesia"], ["IR", "Iran"], ["IQ", "Iraq"], ["IE", "Ireland"], ["IL", "Israel"], ["IT", "Italy"],
  ["JM", "Jamaica"], ["JP", "Japan"], ["JO", "Jordan"], ["KZ", "Kazakhstan"], ["KE", "Kenya"], ["KW", "Kuwait"], ["LV", "Latvia"], ["LB", "Lebanon"],
  ["LY", "Libya"], ["LT", "Lithuania"], ["LU", "Luxembourg"], ["MY", "Malaysia"], ["MT", "Malta"], ["MX", "Mexico"], ["MD", "Moldova"], ["MC", "Monaco"],
  ["MA", "Morocco"], ["NL", "Netherlands"], ["NZ", "New Zealand"], ["NI", "Nicaragua"], ["NG", "Nigeria"], ["KP", "North Korea"], ["MK", "North Macedonia"],
  ["NO", "Norway"], ["OM", "Oman"], ["PK", "Pakistan"], ["PA", "Panama"], ["PY", "Paraguay"], ["PE", "Peru"], ["PH", "Philippines"], ["PL", "Poland"],
  ["PT", "Portugal"], ["QA", "Qatar"], ["RO", "Romania"], ["RU", "Russia"], ["SA", "Saudi Arabia"], ["RS", "Serbia"], ["SG", "Singapore"], ["SK", "Slovakia"],
  ["SI", "Slovenia"], ["ZA", "South Africa"], ["KR", "South Korea"], ["ES", "Spain"], ["LK", "Sri Lanka"], ["SE", "Sweden"], ["CH", "Switzerland"],
  ["SY", "Syria"], ["TW", "Taiwan"], ["TZ", "Tanzania"], ["TH", "Thailand"], ["TN", "Tunisia"], ["TR", "Türkiye"], ["UG", "Uganda"], ["UA", "Ukraine"],
  ["AE", "United Arab Emirates"], ["GB", "United Kingdom"], ["US", "United States"], ["UY", "Uruguay"], ["UZ", "Uzbekistan"], ["VE", "Venezuela"],
  ["VN", "Vietnam"], ["YE", "Yemen"], ["ZM", "Zambia"], ["ZW", "Zimbabwe"],
];
export const countryName = (code: string) => COUNTRIES.find(([c]) => c === code)?.[1] ?? code;

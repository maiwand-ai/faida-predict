// Phase 6 — Visual regression harness (P6.4 of the phase ledger).
// Two complementary modes, chosen per view by how dynamic its data is:
//
//   PIXEL mode  — stable-data views (Robot Studio step 1, Settings provider
//                 form). The screenshot is pixel-diffed against the committed
//                 baseline in tests/visual/baseline/ with a per-channel
//                 tolerance and a diff-percentage budget. Animations and
//                 carets are disabled for determinism.
//   DOM mode    — live-data views (Dashboard, Trading, venue workspace).
//                 Pixel diffs against live market data would flake by design,
//                 so these views get structural assertions instead (key UI
//                 present + visible, no horizontal overflow, venue identity
//                 rendered) and the capture is archived under
//                 tests/visual/archive/ for human diffing.
//
//   bun run visual              # compare against baselines
//   bun run visual -- --update  # (re)write baselines from the current UI
//
// Exit 0 only when every view passes its mode's checks.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE_DIR = join(ROOT, "tests", "visual", "baseline");
const ARCHIVE_DIR = join(ROOT, "tests", "visual", "archive");
const UPDATE = process.argv.includes("--update");

const TOLERANCE = 12; // per-channel 0-255
const BUDGET_PCT = 1.0; // max % of pixels allowed to differ beyond tolerance

// Determinism: kill animations/transitions/carets everywhere.
const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

type Mode = "PIXEL" | "DOM";
interface ViewDef {
  name: string;
  mode: Mode;
  goto: (page: import("playwright").Page) => Promise<void>;
  // PIXEL mode: clip the capture to the top N px — settings grows dynamic
  // cards (governance counters, spend bars) further down the page; the static
  // identity region (custody + risk form) is what visual regression guards.
  clipHeight?: number;
  // DOM mode only: every entry must be visible, else the view fails.
  require?: Array<{ desc: string; sel: string }>;
}

const VIEWS: ViewDef[] = [
  {
    name: "studio-step1",
    mode: "PIXEL",
    goto: async (page) => {
      await page.getByRole("button", { name: "Robot Studio", exact: true }).first().click({ timeout: 20000 });
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "settings-top",
    mode: "PIXEL",
    clipHeight: 430,
    goto: async (page) => {
      await page.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 20000 });
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "dashboard",
    mode: "DOM",
    goto: async (page) => {
      await page.getByRole("button", { name: "Dashboard", exact: true }).first().click({ timeout: 20000 });
      await page.waitForTimeout(1500);
    },
    require: [
      { desc: "KPI band renders", sel: "text=TOTAL PAPER BALANCE" },
      { desc: "venue grid renders", sel: "text=Venues — select a venue to manage its robots, markets and orders" },
      { desc: "decision traces section", sel: "text=Decision traces" },
      { desc: "venue badge present (B11)", sel: ".vc-chip" },
    ],
  },
  {
    name: "trading",
    mode: "DOM",
    goto: async (page) => {
      await page.getByRole("button", { name: "Trading", exact: true }).first().click({ timeout: 20000 });
      await page.waitForTimeout(1500);
    },
    require: [
      { desc: "manual order ticket renders", sel: "text=Manual paper order" },
      { desc: "venue label visible (B11)", sel: ".vc-chip" },
    ],
  },
  {
    name: "venue-workspace",
    mode: "DOM",
    goto: async (page) => {
      // the venue grid lives on the Dashboard only — return there first
      await page.getByRole("button", { name: "Dashboard", exact: true }).first().click({ timeout: 20000 });
      await page.waitForTimeout(1200);
      // the card is a button whose "Open workspace" hint is opacity-0 until
      // hover, so click the card button itself.
      await page.locator("button", { hasText: "Open workspace" }).first().click({ timeout: 20000 });
      await page.waitForTimeout(1500);
    },
    require: [
      { desc: "workspace header names the venue", sel: ".vc-text" },
      { desc: "workspace robots section", sel: "text=Robots on" },
      { desc: "workspace decisions section", sel: "text=Recent decisions on" },
    ],
  },
];

function pngPixels(buf: Buffer): { w: number; h: number; data: Buffer } {
  const png = PNG.sync.read(buf);
  return { w: png.width, h: png.height, data: png.data };
}

function diffPct(a: Buffer, b: Buffer): number {
  const A = pngPixels(a);
  const B = pngPixels(b);
  if (A.w !== B.w || A.h !== B.h) return 100; // size mismatch = total diff
  let diff = 0;
  const total = A.w * A.h;
  for (let i = 0; i < A.data.length; i += 4) {
    if (
      Math.abs(A.data[i] - B.data[i]) > TOLERANCE ||
      Math.abs(A.data[i + 1] - B.data[i + 1]) > TOLERANCE ||
      Math.abs(A.data[i + 2] - B.data[i + 2]) > TOLERANCE
    ) {
      diff++;
    }
  }
  return (diff / total) * 100;
}

const failures: string[] = [];
const report: string[] = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.addStyleTag({ content: FREEZE_CSS });
await page.waitForTimeout(2500);

if (!existsSync(BASELINE_DIR)) mkdirSync(BASELINE_DIR, { recursive: true });
if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });

for (const v of VIEWS) {
  await v.goto(page);
  const shot = await page.screenshot(v.clipHeight ? { clip: { x: 0, y: 0, width: 1440, height: v.clipHeight } } : {});
  if (v.mode === "PIXEL") {
    const baselinePath = join(BASELINE_DIR, `${v.name}.png`);
    if (UPDATE || !existsSync(baselinePath)) {
      writeFileSync(baselinePath, shot);
      report.push(`${UPDATE ? "BASELINE UPDATED" : "BASELINE WRITTEN"}  ${v.name} (PIXEL)`);
      continue;
    }
    const pct = diffPct(readFileSync(baselinePath), shot);
    const ok = pct <= BUDGET_PCT;
    if (!ok) failures.push(`${v.name}: pixel diff ${pct.toFixed(2)}% > budget ${BUDGET_PCT}%`);
    report.push(`${ok ? "PASS" : "FAIL"}  ${v.name} (PIXEL) — diff ${pct.toFixed(2)}% vs baseline (tolerance ${TOLERANCE}, budget ${BUDGET_PCT}%)`);
  } else {
    const missing: string[] = [];
    for (const r of v.require ?? []) {
      const visible = await page.locator(r.sel).first().isVisible().catch(() => false);
      if (!visible) missing.push(`${r.desc} [${r.sel}]`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    const ok = missing.length === 0 && !overflow;
    if (!ok) {
      if (overflow) failures.push(`${v.name}: horizontal overflow`);
      failures.push(`${v.name}: missing ${missing.join(", ")}`);
    }
    // archive the capture with a short retention window (last 20 per view)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(join(ARCHIVE_DIR, `${v.name}-${stamp}.png`), shot);
    const old = readdirSync(ARCHIVE_DIR).filter((f) => f.startsWith(`${v.name}-`)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 20))) rmSync(join(ARCHIVE_DIR, f));
    report.push(`${ok ? "PASS" : "FAIL"}  ${v.name} (DOM) — ${v.require?.length ?? 0} structural checks, ${overflow ? "OVERFLOW" : "no overflow"}, capture archived`);
  }
}

await browser.close();

console.log(`── Visual regression — ${UPDATE ? "baseline update run" : "verification run"} ──`);
for (const line of report) console.log(line);
const pixelCount = VIEWS.filter((v) => v.mode === "PIXEL").length;
console.log(
  failures.length === 0
    ? `\nVISUAL PASS — ${pixelCount} pixel-diff view(s) within budget, ${VIEWS.length - pixelCount} DOM-structural view(s) clean`
    : `\nVISUAL FAIL — ${failures.length} problem(s):\n  ${failures.join("\n  ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);

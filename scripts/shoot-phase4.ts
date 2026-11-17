// Phase 4 screenshot pass — touched views (verification protocol §7.4).
//  1. dashboard venue grid (Limitless card now live-styled, magenta identity)
//  2. Limitless workspace (TOUCH depth column, structural note, create CTA)
//  3. Polymarket workspace (in-trade table with A-04 CLUSTER chips)
//  4. Trading ticket on a Limitless market
import { chromium } from "playwright";

const shots: Array<{ click: string | null; file: string; wait?: number }> = [
  { click: null, file: "/tmp/render/p4-dashboard.png" },
  { click: "Open Limitless workspace", file: "/tmp/render/p4-limitless-workspace.png" },
  { click: "Back to dashboard", file: null, wait: 800 },
  { click: "Open Polymarket workspace", file: "/tmp/render/p4-polymarket-workspace.png" },
  { click: "Back to dashboard", file: null, wait: 800 },
  { click: "Trading", file: "/tmp/render/p4-trading.png" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(2500);
for (const s of shots) {
  if (s.click) {
    await page.getByRole("button", { name: s.click, exact: false }).first().click({ timeout: 15000 });
    await page.waitForTimeout(s.wait ?? 2500);
  }
  if (s.file) {
    await page.screenshot({ path: s.file, fullPage: true });
    console.log("shot:", s.file);
  }
}
await browser.close();
console.log("done");

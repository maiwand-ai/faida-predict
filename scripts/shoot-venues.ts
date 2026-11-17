// B12 venue color identity — screenshot the colored surfaces for visual review.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(1500);

// 1. Dashboard — venue grid with all six venue-colored cards
await page.screenshot({ path: "/tmp/render/ven-1-dashboard.png" });
console.log("shot: ven-1-dashboard.png");

// 2. Polymarket workspace (LIVE — full blue interior)
await page.getByRole("button", { name: "Open Polymarket workspace" }).first().click({ timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/render/ven-2-workspace-polymarket.png" });
console.log("shot: ven-2-workspace-polymarket.png");

// 3. Azuro workspace (PENDING — muted lavender interior)
await page.getByRole("button", { name: "← Back to dashboard" }).first().click({ timeout: 15000 });
await page.waitForTimeout(600);
await page.getByRole("button", { name: "Open Azuro workspace" }).first().click({ timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/render/ven-3-workspace-azuro.png" });
console.log("shot: ven-3-workspace-azuro.png");

// 4. Markets — per-venue colored sections
await page.getByRole("button", { name: "← Back to dashboard" }).first().click({ timeout: 15000 });
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Markets", exact: true }).first().click({ timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/render/ven-4-markets.png" });
console.log("shot: ven-4-markets.png");

// 5. Trade dialog — venue-colored ticket (open first market's Trade button)
const tradeBtn = page.getByRole("button", { name: "Trade", exact: true }).first();
if (await tradeBtn.count()) {
  await tradeBtn.click({ timeout: 10000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/render/ven-5-trade-dialog.png" });
  console.log("shot: ven-5-trade-dialog.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

// 6. Robot Studio — venue picker with per-venue colors
await page.getByRole("button", { name: "Robot Studio", exact: false }).first().click({ timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/render/ven-6-studio.png" });
console.log("shot: ven-6-studio.png");

await browser.close();

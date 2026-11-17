// Phase 6 screenshot pass — touched views (verification protocol §7.4).
//  1. Robot Studio step 1 — template gallery (P-03) + suspended Drift BET note
//  2. Robot Studio step 2 — editable C5 strategy knobs
//  3. Dashboard — an expanded decision trace: provenance envelope + risk checks (A-08)
//  4. Venue workspace — trace depth in the venue-scoped list
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

// 1. Studio step 1 — template gallery
await page.getByRole("button", { name: "Robot Studio", exact: true }).first().click({ timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/render/p6-studio-templates.png" });
console.log("shot: /tmp/render/p6-studio-templates.png");

// 2. Studio step 2 — strategy knobs (move forward via the step rail)
await page.getByRole("button", { name: "2 Strategy & model", exact: false }).first().click({ timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/render/p6-studio-knobs.png" });
console.log("shot: /tmp/render/p6-studio-knobs.png");

// 3. Dashboard with an expanded trace (A-08 depth)
await page.getByRole("button", { name: "Dashboard", exact: true }).first().click({ timeout: 20000 });
await page.waitForTimeout(1500);
await page.locator("button", { hasText: "· edge" }).first().click({ timeout: 15000 });
await page.waitForTimeout(800);
await page.getByText("Decision traces", { exact: false }).first().scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/render/p6-trace-depth.png" });
console.log("shot: /tmp/render/p6-trace-depth.png");

// 4. Venue workspace with the same expanded-trace behavior
await page.locator("button", { hasText: "Open workspace" }).first().click({ timeout: 20000 });
await page.waitForTimeout(1500);
const ws = page.locator("button", { hasText: "· edge" }).first();
await ws.click({ timeout: 15000 });
await page.waitForTimeout(800);
await page.getByText("Recent decisions on", { exact: false }).first().scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/render/p6-venue-trace.png" });
console.log("shot: /tmp/render/p6-venue-trace.png");

await browser.close();
console.log("done");

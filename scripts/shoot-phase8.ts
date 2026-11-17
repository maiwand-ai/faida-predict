// Phase 8 screenshot pass — touched views (verification protocol §7.4).
//  1. Settings — notification taxonomy & anti-storm (P-04) card
//  2. Settings — export & read-only API keys (P-06) card
//  3. Settings — compliance ops / retention (P-07) card
//  4. Settings — platform metrics (P-08) card with per-venue freshness (B11)
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

await page.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 20000 });
await page.waitForTimeout(2000);

// 1. P-04 taxonomy card
await page.getByText("Notification taxonomy & anti-storm", { exact: false }).first().scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/render/p8-p04-taxonomy.png" });
console.log("shot: /tmp/render/p8-p04-taxonomy.png");

// 2. P-06 export & keys card (scroll further so the frame is distinct)
await page.getByText("Create key", { exact: false }).first().scrollIntoViewIfNeeded();
await page.mouse.wheel(0, -420);
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/render/p8-p06-keys.png" });
console.log("shot: /tmp/render/p8-p06-keys.png");

// 3. P-07 compliance + retention card
await page.getByText("Run retention now", { exact: false }).first().scrollIntoViewIfNeeded();
await page.mouse.wheel(0, -360);
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/render/p8-p07-retention.png" });
console.log("shot: /tmp/render/p8-p07-retention.png");

// 4. P-08 metrics card (per-venue freshness visible)
await page.getByText("SYNC FRESHNESS PER VENUE", { exact: false }).first().scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/render/p8-p08-metrics.png" });
console.log("shot: /tmp/render/p8-p08-metrics.png");

await browser.close();

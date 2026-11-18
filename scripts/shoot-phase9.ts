// Phase 9 screenshot pass — mobile shell (C18) + Kalshi venue surfaces
// (verification protocol §7.4). Mobile viewport 390×844 (iPhone-class) plus
// one desktop shot of the Settings custody card with the second credential kind.
//  1. Dashboard on mobile — bottom tab bar + mobile header
//  2. Kalshi venue workspace on mobile — adapter live, venue-labeled
//  3. Markets on mobile — stacked columns (PARITY/VOLUME/SOURCE hidden)
//  4. Settings on desktop — custody card with the Kalshi credential-kind row
import { chromium } from "playwright";

const browser = await chromium.launch();
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await mobile.waitForTimeout(2500);

// 1. mobile dashboard with the bottom tab bar
await mobile.screenshot({ path: "/tmp/render/p9-mobile-dashboard.png" });
console.log("shot: /tmp/render/p9-mobile-dashboard.png");

// 2. open the Kalshi venue workspace from the venue grid (visible card only —
//    the sidebar/footer copies are display:none on mobile)
await mobile.locator("button.venue-card", { hasText: "Kalshi" }).first().click({ timeout: 20000 });
await mobile.waitForTimeout(1800);
await mobile.screenshot({ path: "/tmp/render/p9-mobile-kalshi.png" });
console.log("shot: /tmp/render/p9-mobile-kalshi.png");

// 3. markets view via the bottom tab bar
await mobile.getByRole("button", { name: "Markets" }).last().click({ timeout: 20000 });
await mobile.waitForTimeout(1800);
await mobile.screenshot({ path: "/tmp/render/p9-mobile-markets.png" });
console.log("shot: /tmp/render/p9-mobile-markets.png");

// 4. desktop Settings — custody card with the second credential kind
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await desktop.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await desktop.waitForTimeout(2200);
await desktop.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 20000 });
await desktop.waitForTimeout(1800);
await desktop.getByText("Custody — decision B1", { exact: false }).first().scrollIntoViewIfNeeded();
await desktop.waitForTimeout(500);
await desktop.screenshot({ path: "/tmp/render/p9-desktop-custody.png" });
console.log("shot: /tmp/render/p9-desktop-custody.png");

await browser.close();

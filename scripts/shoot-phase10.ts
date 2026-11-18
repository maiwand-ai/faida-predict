// Phase 10 screenshot pass — beta operations surfaces (verification protocol
// §7.4). Desktop shots of: Beta Ops view (operator instruments), login page,
// register page. Plus one mobile shot proving the bottom tab bar carries the
// new Beta Ops tab (C18 continuity).
//  1. Desktop Beta Ops (operator fallback): R-0 snapshot, exit bar, cohort,
//     defect ladder, feedback inbox
//  2. Desktop /login — closed-beta sign-in
//  3. Desktop /register — enrollment-gated registration
//  4. Mobile dashboard — bottom tab bar includes Beta Ops (6 tabs)
import { chromium } from "playwright";

await import("fs").then((fs) => fs.mkdirSync("/tmp/render", { recursive: true }));

const browser = await chromium.launch();

// 1. desktop Beta Ops
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
await desktop.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await desktop.waitForTimeout(2500);
await desktop.getByRole("button", { name: "Beta Ops" }).first().click({ timeout: 20000 });
await desktop.waitForTimeout(2500);
await desktop.screenshot({ path: "/tmp/render/p10-desktop-betaops.png", fullPage: false });
console.log("shot: /tmp/render/p10-desktop-betaops.png");

// exit bar deeper scroll (bottom half of the view)
await desktop.getByText("EXIT BAR", { exact: false }).first().scrollIntoViewIfNeeded();
await desktop.waitForTimeout(600);
await desktop.screenshot({ path: "/tmp/render/p10-desktop-exitbar.png" });
console.log("shot: /tmp/render/p10-desktop-exitbar.png");

// 2. login
const login = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await login.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await login.waitForTimeout(1200);
await login.screenshot({ path: "/tmp/render/p10-login.png" });
console.log("shot: /tmp/render/p10-login.png");

// 3. register
await login.goto("http://localhost:3000/register", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await login.waitForTimeout(1200);
await login.screenshot({ path: "/tmp/render/p10-register.png" });
console.log("shot: /tmp/render/p10-register.png");

// 4. mobile — bottom tab bar with Beta Ops
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await mobile.waitForTimeout(2200);
await mobile.screenshot({ path: "/tmp/render/p10-mobile-dashboard.png" });
console.log("shot: /tmp/render/p10-mobile-dashboard.png");
await mobile.getByRole("button", { name: "Beta Ops" }).last().click({ timeout: 20000 });
await mobile.waitForTimeout(2200);
await mobile.screenshot({ path: "/tmp/render/p10-mobile-betaops.png" });
console.log("shot: /tmp/render/p10-mobile-betaops.png");

await browser.close();
console.log("PHASE 10 SHOTS DONE");

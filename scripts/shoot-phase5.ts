// Phase 5 screenshot pass — touched views (verification protocol §7.4).
//  1. Settings — model registry & calibration card (A-01/A-03) + AI governance card (A-07)
//  2. Dashboard — decision traces with model provenance chips (A-02)
import { chromium } from "playwright";

const shots: Array<{ click: string | null; file: string | null; wait?: number }> = [
  { click: null, file: "/tmp/render/p5-dashboard.png" },
  { click: "Settings", file: null, wait: 3000 },
  { click: null, file: "/tmp/render/p5-settings-top.png", wait: 1200 },
  { click: null, file: "/tmp/render/p5-settings-registry.png", wait: 500 },
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
    if (s.file.includes("registry")) {
      // scroll the model registry card into view
      await page.getByText("Model registry — calibration", { exact: false }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
    }
    await page.screenshot({ path: s.file, fullPage: s.file.includes("settings") });
    console.log("shot:", s.file);
  }
}
await browser.close();
console.log("done");

// Screenshot the touched views of the single-page app (B11/Phase 3 verification).
import { chromium } from "playwright";

const shots: Array<{ click: string | null; file: string }> = [
  { click: null, file: "/tmp/render/overview-live.png" },
  { click: "Markets", file: "/tmp/render/markets.png" },
  { click: "Robot Studio", file: "/tmp/render/studio.png" },
  { click: "Trading", file: "/tmp/render/trading.png" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
for (const s of shots) {
  if (s.click) {
    await page.getByRole("button", { name: s.click, exact: false }).first().click({ timeout: 10000 });
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: s.file });
  console.log("shot:", s.file);
}
await browser.close();

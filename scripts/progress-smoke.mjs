// Walks the /progress gate and log: redirect without a cookie, wrong password, right password, both widths.
// usage: PROGRESS_PASSWORD=... node scripts/progress-smoke.mjs <base> [outDir]   (PW_CHANNEL=chrome to use system Chrome)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const base = process.argv[2];
const out = process.argv[3] || "progress-shots";
const pw = process.env.PROGRESS_PASSWORD;
if (!base || !pw) { console.error("usage: PROGRESS_PASSWORD=... node scripts/progress-smoke.mjs <base> [outDir]"); process.exit(2); }
mkdirSync(out, { recursive: true });
let failed = false;
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
for (const [label, opts] of [["desktop", { viewport: { width: 1280, height: 860 } }], ["mobile", { viewport: { width: 375, height: 812 }, isMobile: true, deviceScaleFactor: 2 }]]) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  const r = await page.goto(base + "/progress", { waitUntil: "load" });
  console.log(label, "no cookie ->", page.url().replace(base, ""));
  if (!page.url().endsWith("/progress/login")) failed = true;
  await page.screenshot({ path: `${out}/${label}-login.png` });
  await page.fill("#progress-password", "nope"); await page.getByRole("button", { name: /open/i }).click();
  await page.locator("#progress-error").waitFor({ timeout: 8000 }); console.log(label, "wrong ->", (await page.locator("#progress-error").textContent()).trim());
  await page.screenshot({ path: `${out}/${label}-wrong.png` });
  await page.fill("#progress-password", pw); await page.getByRole("button", { name: /open/i }).click();
  await page.waitForURL("**/progress", { timeout: 30000 }); await page.waitForTimeout(1500);
  const entries = await page.locator("article").count(); const problem = await page.locator("main p").first().textContent();
  console.log(label, "right ->", page.url().replace(base, ""), "| entries:", entries, "| first p:", (problem||"").slice(0, 60));
  if (!page.url().endsWith("/progress")) failed = true;
  await page.screenshot({ path: `${out}/${label}-log.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
if (failed) { console.error("progress-smoke: FAILED"); process.exit(1); }
console.log("progress-smoke: all passed");

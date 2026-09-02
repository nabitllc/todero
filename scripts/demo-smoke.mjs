// The drift gate: walks every demo screen and drives the four interactions
// against a running site. Fails on any unhandled demo endpoint (599), any
// 5xx, or a console error. Usage: node scripts/demo-smoke.mjs http://localhost:3000
import { chromium } from "playwright";

const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const P = "KEL";
const demo = `${base}/demo`;
const screens = ["issues", `issues/${P}-3`, "", "agents", "approvals", "activity", "goals", "projects", "routines", "inbox", "org", "company/settings"];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const problems = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/") && (r.status() >= 500 || r.status() === 599)) problems.push(`${r.status()} ${r.request().method()} ${new URL(u).pathname}`);
});
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !/Failed to load resource.*404/.test(t)) problems.push("console: " + t.slice(0, 160));
});
page.on("pageerror", (e) => problems.push("pageerror: " + String(e.message).slice(0, 160)));

let failed = 0;
const check = async (name, fn) => {
  const before = problems.length;
  try {
    await fn();
    const fresh = [...new Set(problems.slice(before))];
    if (fresh.length) { failed++; console.log("FAIL", name); for (const p of fresh) console.log("   ", p); }
    else console.log("ok  ", name);
  } catch (e) {
    failed++;
    console.log("FAIL", name, "|", String(e.message).split("\n")[0].slice(0, 160));
    for (const p of [...new Set(problems.slice(before))]) console.log("   ", p);
  }
};

for (const s of screens) {
  await check(`screen /${P}/${s}`, async () => {
    await page.goto(`${demo}/${P}/${s}`, { waitUntil: "load", timeout: 40000 });
    await page.waitForTimeout(1800);
    const title = await page.title();
    if (!/Kelp Works/.test(title)) throw new Error(`title "${title}" is not the demo company`);
  });
}

await check("comment and @Build gets a reply", async () => {
  await page.goto(`${demo}/${P}/issues/${P}-3`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const box = page.getByPlaceholder(/comment, or @ an agent/i).first();
  await box.click();
  await box.fill("@Build what's left on this?");
  await box.press("Control+Enter").catch(() => {});
  await page.waitForTimeout(600);
  if (!(await page.getByText("what's left on this?").count())) {
    await page.getByRole("button", { name: /^(comment|send|post)$/i }).first().click();
  }
  await page.getByText("what's left on this?").first().waitFor({ timeout: 5000 });
  await page.getByText(/Left to do: the search index/).first().waitFor({ timeout: 10000 });
});

await check("approve the hire; Support appears", async () => {
  await page.goto(`${demo}/${P}/approvals`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.getByText(/^Support$/).first().waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: /^approve$/i }).first().click();
  await page.waitForTimeout(1500);
  await page.goto(`${demo}/${P}/agents`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.getByText(/^Support$/).first().waitFor({ timeout: 5000 });
});

await check("create a task, move it, survive a reload", async () => {
  await page.goto(`${demo}/${P}/issues`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /new task/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByPlaceholder("Task title").first().fill("Write the changelog");
  await page.getByRole("button", { name: /create/i }).last().click();
  await page.waitForTimeout(1500);
  await page.goto(`${demo}/${P}/issues/${P}-9`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /change status/i }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /in progress/i }).last().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /change status \(current: In Progress\)/i }).first().waitFor({ timeout: 5000 });
  await page.goto(`${demo}/${P}/issues`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.getByText("Write the changelog").first().waitFor({ timeout: 5000 });
});

await check("reset restores the seed", async () => {
  await page.getByRole("button", { name: /^reset$/i }).first().click();
  await page.waitForTimeout(2500);
  if (await page.getByText("Write the changelog").count()) throw new Error("created task survived Reset");
});

await browser.close();
console.log(failed ? `demo-smoke: ${failed} failed` : "demo-smoke: all passed");
process.exit(failed ? 1 : 0);

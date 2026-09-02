// Builds the public demo — the real local/ui in demo mode — into public/demo/
// so the Next site serves it at /demo. Runs before `next build`, locally and
// on Vercel. Skipped with TODERO_SKIP_DEMO=1.
import { execSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, "local");
const ui = path.join(local, "ui");
const out = path.join(root, "public", "demo");

if (process.env.TODERO_SKIP_DEMO === "1") {
  console.log("build-demo: skipped (TODERO_SKIP_DEMO=1)");
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(path.join(local, "package.json"), "utf8"));
const pnpmSpec = pkg.packageManager?.startsWith("pnpm@") ? pkg.packageManager : "pnpm@latest";
const pnpm = `npx --yes ${pnpmSpec}`;
// NODE_ENV=development so pnpm installs the UI's devDependencies (vite is one)
// even where the host sets production, as Vercel does.
const run = (cmd, cwd) => {
  console.log(`build-demo: ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, NODE_ENV: "development", VITE_TODERO_DEMO: "1" } });
};

if (!existsSync(path.join(ui, "node_modules"))) {
  run(`${pnpm} install --frozen-lockfile --filter @todero/ui...`, local);
}
run(`${pnpm} --dir ui build:demo`, local);

rmSync(out, { recursive: true, force: true });
cpSync(path.join(ui, "dist-demo"), out, { recursive: true });
console.log(`build-demo: wrote ${out}`);

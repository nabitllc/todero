// Run one or more package.json scripts from the repo root; stop at the first failure.
//   node checks/pnpm-run.mjs check:tokens check:token-gates
import { run } from "./_lib.mjs";

const scripts = process.argv.slice(2);
if (scripts.length === 0) {
  console.error("usage: node checks/pnpm-run.mjs <script> [<script> ...]");
  process.exit(2);
}
for (const script of scripts) {
  console.log(`[gauntlet] pnpm ${script}`);
  const code = run("pnpm", [script]);
  if (code !== 0) process.exit(code);
}

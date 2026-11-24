#!/usr/bin/env node
// Brain2 machine check before a heavy npm script (pretest, prebuild, pretypecheck).
// Brain2 rule Wiring/docs/Where_Work_Runs.md § Machine check (2026-11-24): a heavy job on a laptop
// whose memory is full runs in the cloud or waits. Living in the npm script, it holds for every
// caller - any AI tool, any model, a person - not only for sessions that read Brain2.
// It never breaks a run: no vault on this machine (Vercel, CI, a cloud session), no Python, or any
// error -> exit 0 silently. Warn mode prints the warning and exits 0; only Brain2's block mode
// (BRAIN2_GUARD_MODE=block) stops the script. Skip once with BRAIN2_GUARD=off.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const job = process.argv[2] ?? "heavy job";

function vaultGuard() {
  const candidates = [
    process.env.BRAIN2_VAULT,
    path.join(homedir(), "Development", "Mich-Brain2"),
    path.join(homedir(), "Mich-Brain2"),
  ].filter(Boolean);
  for (const root of candidates) {
    const guard = path.join(root, "Wiring", "machine-guard.py");
    if (existsSync(guard)) return guard;
  }
  return null;
}

try {
  if (process.env.BRAIN2_GUARD === "off" || process.env.CLAUDE_CODE_REMOTE === "true" || process.env.CI) process.exit(0);
  const guard = vaultGuard();
  if (!guard) process.exit(0);
  for (const python of ["python", "python3", "py"]) {
    const r = spawnSync(python, [guard, "--job", job], { stdio: ["ignore", "ignore", "inherit"], timeout: 10_000 });
    if (r.error || r.status === null || r.status === 9009) continue; // not installed / Windows store stub
    process.exit(r.status === 3 ? 1 : 0);
  }
  process.exit(0);
} catch {
  process.exit(0);
}

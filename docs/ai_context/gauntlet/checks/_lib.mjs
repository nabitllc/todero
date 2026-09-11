// Shared helpers for the gauntlet checks. The runner starts every check with
// cwd = docs/ai_context/gauntlet, so the repo root is three levels up.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** Run a command from a directory under the repo root; inherit output; return its exit code. */
export function run(cmd, args, cwdRel = ".") {
  const cwd = path.join(REPO_ROOT, cwdRel);
  const isWin = process.platform === "win32";
  // pnpm is a .cmd shim on Windows; go through cmd.exe explicitly rather than
  // shell: true so the arguments are passed as given.
  const result = isWin && cmd === "pnpm"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], { cwd, stdio: "inherit" })
    : spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.error) {
    console.error(`[gauntlet] ${cmd} failed to start: ${result.error.message}`);
    return 127;
  }
  return result.status ?? 1;
}

/** The vitest entry point of a workspace package, resolved from the repo's node_modules. */
export function vitestBin() {
  return path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");
}

export function tscBin() {
  return path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");
}

// File-size caps from docs/ai_context/file_size_limits.md, as a check rather
// than advice: a file that grows past its hard cap fails, and a file that was
// already over the cap on main may not grow. The baseline is the committed
// allowlist below; a new outlier is a failure, and shrinking one below the cap
// removes it from the list.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./_lib.mjs";

const HARD_CAP = { component: 400, module: 500 };
const ALLOWLIST_PATH = path.join(REPO_ROOT, "docs", "ai_context", "gauntlet", "file-size-allowlist.json");
// --write-allowlist rewrites the standing-outlier list from the current tree:
// used once when the check was added, and again whenever an outlier shrinks.
const WRITE = process.argv.includes("--write-allowlist");
const allowlist = WRITE ? {} : JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));

/** Lines as an editor counts them: a trailing newline does not add an empty line. */
function countLines(text) {
  if (text.length === 0) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const roots = ["ui/src", "server/src", "packages/shared/src", "packages/db/src", "cli/src"].map((r) => path.join(REPO_ROOT, r));
const files = roots.filter((r) => { try { return statSync(r).isDirectory(); } catch { return false; } }).flatMap((r) => walk(r, []));

let failed = 0;
const outliers = {};
for (const file of files) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
  const lines = countLines(readFileSync(file, "utf8"));
  const cap = rel.endsWith(".tsx") ? HARD_CAP.component : HARD_CAP.module;
  if (lines <= cap) continue;
  outliers[rel] = lines;
  if (WRITE) continue;
  const allowed = allowlist[rel];
  if (allowed === undefined) {
    console.error(`[file-size] NEW outlier ${rel}: ${lines} lines (cap ${cap})`);
    failed += 1;
  } else if (lines > allowed) {
    console.error(`[file-size] GREW ${rel}: ${lines} lines (was ${allowed}, cap ${cap})`);
    failed += 1;
  }
}
if (WRITE) {
  const sorted = Object.fromEntries(Object.entries(outliers).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`[file-size] allowlist written: ${Object.keys(sorted).length} standing outliers`);
  process.exit(0);
}
console.log(`[file-size] ${files.length} files checked, ${Object.keys(allowlist).length} standing outliers, ${failed} failure(s)`);
process.exit(failed > 0 ? 1 : 0);

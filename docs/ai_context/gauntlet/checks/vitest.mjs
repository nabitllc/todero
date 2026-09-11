// Run vitest in one workspace package, optionally limited to files or folders.
//   node checks/vitest.mjs ui
//   node checks/vitest.mjs server src/todero src/__tests__/openapi-routes.test.ts
// A file that does not exist yet still fails the check, which is what a
// not-yet-built item's check should do.
import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, run, vitestBin } from "./_lib.mjs";

const [pkg, ...targets] = process.argv.slice(2);
if (!pkg) {
  console.error("usage: node checks/vitest.mjs <package-dir> [<file-or-dir> ...]");
  process.exit(2);
}
const missing = targets.filter((target) => !existsSync(path.join(REPO_ROOT, pkg, target)));
if (missing.length > 0) {
  console.error(`[gauntlet] missing test target(s) in ${pkg}: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`[gauntlet] vitest in ${pkg}${targets.length ? ": " + targets.join(" ") : " (whole package)"}`);
process.exit(run(process.execPath, [vitestBin(), "run", ...targets, "--reporter=dot"], pkg));

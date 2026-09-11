// Run vitest in one workspace package, optionally limited to files or folders.
//   node checks/vitest.mjs ui
//   node checks/vitest.mjs server src/todero src/__tests__/openapi-routes.test.ts
// A file that does not exist yet still fails the check, which is what a
// not-yet-built item's check should do.
import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, run, vitestBin } from "./_lib.mjs";

// --gauntlet runs through the package's vitest.gauntlet.config.ts, the only
// config that includes the *.gauntlet.ts(x) item checks.
const argv = process.argv.slice(2);
const gauntlet = argv.includes("--gauntlet");
const [pkg, ...targets] = argv.filter((arg) => arg !== "--gauntlet");
if (!pkg) {
  console.error("usage: node checks/vitest.mjs [--gauntlet] <package-dir> [<file-or-dir> ...]");
  process.exit(2);
}
const configArgs = gauntlet ? ["--config", "vitest.gauntlet.config.ts"] : [];
const missing = targets.filter((target) => !existsSync(path.join(REPO_ROOT, pkg, target)));
if (missing.length > 0) {
  console.error(`[gauntlet] missing test target(s) in ${pkg}: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`[gauntlet] vitest in ${pkg}${targets.length ? ": " + targets.join(" ") : " (whole package)"}`);
process.exit(run(process.execPath, [vitestBin(), "run", ...configArgs, ...targets, "--reporter=dot"], pkg));

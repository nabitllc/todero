// Typecheck one or more workspace packages with their own tsconfig; stop at the first failure.
//   node checks/tsc.mjs packages/shared server ui
import { run, tscBin } from "./_lib.mjs";

const packages = process.argv.slice(2);
if (packages.length === 0) {
  console.error("usage: node checks/tsc.mjs <package-dir> [<package-dir> ...]");
  process.exit(2);
}
for (const pkg of packages) {
  console.log(`[gauntlet] tsc --noEmit in ${pkg}`);
  const code = run(process.execPath, [tscBin(), "--noEmit", "-p", "."], pkg);
  if (code !== 0) process.exit(code);
}

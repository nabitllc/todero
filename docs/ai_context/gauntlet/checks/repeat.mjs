// Run one vitest file N times in a row; any failure fails the check. For
// timing flakes that only show under repetition.
//   node checks/repeat.mjs 5 server src/__tests__/instance-settings-routes.test.ts
import { run, vitestBin } from "./_lib.mjs";

const [countRaw, pkg, file] = process.argv.slice(2);
const count = Number.parseInt(countRaw ?? "", 10);
if (!Number.isFinite(count) || count < 1 || !pkg || !file) {
  console.error("usage: node checks/repeat.mjs <count> <package-dir> <test-file>");
  process.exit(2);
}
for (let i = 1; i <= count; i += 1) {
  console.log(`[gauntlet] run ${i} of ${count}: ${pkg}/${file}`);
  const code = run(process.execPath, [vitestBin(), "run", file, "--reporter=dot"], pkg);
  if (code !== 0) {
    console.error(`[gauntlet] failed on run ${i} of ${count}`);
    process.exit(code);
  }
}

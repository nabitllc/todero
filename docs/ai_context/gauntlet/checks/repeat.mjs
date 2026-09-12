// Run one vitest file N times in a row; any failure fails the check. For
// timing flakes that only show under repetition.
//   node checks/repeat.mjs 5 server src/__tests__/instance-settings-routes.test.ts
// The run that fails ends with the names of the failed tests, so the runner's
// short tail names the flake instead of showing the last stack trace.
import { runCaptured, vitestBin } from "./_lib.mjs";

const [countRaw, pkg, file] = process.argv.slice(2);
const count = Number.parseInt(countRaw ?? "", 10);
if (!Number.isFinite(count) || count < 1 || !pkg || !file) {
  console.error("usage: node checks/repeat.mjs <count> <package-dir> <test-file>");
  process.exit(2);
}
for (let i = 1; i <= count; i += 1) {
  console.log(`[gauntlet] run ${i} of ${count}: ${pkg}/${file}`);
  const { status, output } = runCaptured(process.execPath, [vitestBin(), "run", file, "--reporter=dot"], pkg);
  if (status !== 0) {
    const failed = [...new Set(output.split(/\r?\n/).filter((line) => /^\s*FAIL\s/.test(line)).map((line) => line.trim()))];
    const messages = output.split(/\r?\n/).filter((line) => /Error:|expected/.test(line) && !/^\s+at /.test(line)).slice(0, 4);
    console.error(`[gauntlet] failed on run ${i} of ${count}`);
    for (const line of failed) console.error(`  ${line}`);
    for (const line of messages) console.error(`  ${line.trim()}`);
    process.exit(status);
  }
}

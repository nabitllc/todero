import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// `pnpm exec vitest` cannot be spawned portably: on Windows the pnpm executable
// is `pnpm.cmd`, which `spawnSync` refuses to start without a shell (ENOENT),
// and a shell would put cmd.exe quoting rules between the runner and the file
// paths and `--shard=` values it passes. Launch the package's own entry point
// under the current Node binary instead. Resolution is lazy so `--dry-run` and
// the shard-partition tests keep working on a checkout with no `node_modules`.
export function resolveVitestLaunch(rootDir) {
  const require = createRequire(path.join(rootDir, "package.json"));
  let packageJsonPath;
  try {
    packageJsonPath = require.resolve("vitest/package.json", { paths: [rootDir] });
  } catch (error) {
    throw new Error(
      `Unable to resolve the vitest package from ${rootDir}; run \`pnpm install\` first. (${error.message})`,
    );
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const bin =
    typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.vitest ?? null;
  if (!bin) {
    throw new Error(`The vitest package at ${packageJsonPath} does not declare a bin entry.`);
  }
  return {
    command: process.execPath,
    args: [path.resolve(path.dirname(packageJsonPath), bin)],
  };
}

// `pnpm exec` prepends the workspace's `node_modules/.bin` to PATH before it
// runs the bin. Mirror that so the child sees the same environment on every
// platform. Windows names the variable `Path`, so match the key case-insensitively.
export function withNodeModulesBinOnPath(env, rootDir) {
  const binDir = path.join(rootDir, "node_modules", ".bin");
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const existing = env[pathKey];
  return {
    ...env,
    [pathKey]: existing ? `${binDir}${path.delimiter}${existing}` : binDir,
  };
}

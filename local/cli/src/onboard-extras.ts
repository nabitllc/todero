import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RECOMMENDED_VAULT_REPO_URL = "https://github.com/nabitllc/todero-brain.git";
export const ONBOARD_PREREQUISITES = ["node", "git", "pnpm"] as const;

export type OnboardGitExec = (args: readonly string[]) => void;

const WIN32_EXECUTABLE_EXTS = [".exe", ".cmd", ".bat", ".com", ""];
const POSIX_EXECUTABLE_EXTS = [""];

export function commandOnPath(
  name: string,
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): boolean {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathEnv = env.PATH ?? env.Path ?? "";
  if (!pathEnv) return false;
  const exts =
    platform === "win32"
      ? (env.PATHEXT?.split(path.delimiter).filter(Boolean) ?? WIN32_EXECUTABLE_EXTS)
      : POSIX_EXECUTABLE_EXTS;
  const normalizedExts = exts.map((ext) => (ext.startsWith(".") || ext === "" ? ext : `.${ext}`));
  if (platform === "win32" && !normalizedExts.includes("")) normalizedExts.push("");
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of normalizedExts) {
      const candidate = path.join(dir, platform === "win32" ? `${name}${ext}` : name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
      } catch {
      }
    }
  }
  return false;
}

export function missingOnboardPrerequisites(
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): string[] {
  return ONBOARD_PREREQUISITES.filter((name) => !commandOnPath(name, options));
}

export function assertOnboardPrerequisites(
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): void {
  const missing = missingOnboardPrerequisites(options);
  if (missing.length === 0) return;
  throw new Error(
    `Todero requires Node.js, git, and pnpm on PATH. Missing: ${missing.join(", ")}.`,
  );
}

export function resolveOnboardSettingsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.TODERO_SETTINGS_DIR?.trim();
  if (override) return path.resolve(override);
  const home = env.TODERO_HOME?.trim() || env.PAPERCLIP_HOME?.trim();
  if (home) return path.resolve(home);
  return path.join(os.homedir(), ".todero");
}

export function resolveOnboardRecommendedVaultPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.TODERO_VAULT_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(resolveOnboardSettingsDir(env), "todero-brain");
}

function runGit(args: readonly string[]): void {
  try {
    execFileSync("git", [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr =
      typeof e.stderr === "string" ? e.stderr : Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf8") : "";
    throw new Error(stderr.trim() || e.message || String(err));
  }
}

export function ensureOnboardRecommendedVault(options?: {
  gitExec?: OnboardGitExec;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = options?.env ?? process.env;
  const dest = resolveOnboardRecommendedVaultPath(env);
  if (dest.includes("Mich-Brain2")) {
    throw new Error("Refusing to use Mich-Brain2 as the Recommended Second Brain path.");
  }
  const git = options?.gitExec ?? runGit;
  const present = fs.existsSync(dest);
  try {
    if (present) {
      git(["-C", dest, "pull"]);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      git(["clone", RECOMMENDED_VAULT_REPO_URL, dest]);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      present
        ? `Failed to update Recommended Second Brain: ${detail}`
        : `Failed to clone Recommended Second Brain: ${detail}`,
    );
  }
  if (!fs.existsSync(dest)) {
    throw new Error("Recommended Second Brain folder is missing after git clone/pull.");
  }
  const settingsDir = resolveOnboardSettingsDir(env);
  fs.mkdirSync(settingsDir, { recursive: true });
  const row = {
    id: 1 as const,
    source: "recommended" as const,
    path: dest,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(settingsDir, "vault-settings.json"), `${JSON.stringify(row, null, 2)}\n`, "utf8");
  return dest;
}

export function posixStartScript(): string {
  return [
    "#!/bin/sh",
    "set -e",
    "if command -v todero >/dev/null 2>&1; then",
    "  exec todero run",
    "fi",
    "if [ -x \"$HOME/.local/bin/todero\" ]; then",
    "  exec \"$HOME/.local/bin/todero\" run",
    "fi",
    "exec npx --yes todero run",
    "",
  ].join("\n");
}

export function windowsStartScript(): string {
  return [
    "@echo off",
    "title Todero",
    "where todero >nul 2>&1 && (",
    "  todero run",
    "  goto :eof",
    ")",
    "if exist \"%USERPROFILE%\\.local\\bin\\todero.cmd\" (",
    "  \"%USERPROFILE%\\.local\\bin\\todero.cmd\" run",
    "  goto :eof",
    ")",
    "npx --yes todero run",
    "",
  ].join("\r\n");
}

export function macAppInfoPlist(): string {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>CFBundleName</key>",
    "  <string>Todero</string>",
    "  <key>CFBundleDisplayName</key>",
    "  <string>Todero</string>",
    "  <key>CFBundleIdentifier</key>",
    "  <string>com.nabitllc.todero</string>",
    "  <key>CFBundleVersion</key>",
    "  <string>1.0</string>",
    "  <key>CFBundleExecutable</key>",
    "  <string>Todero</string>",
    "  <key>CFBundlePackageType</key>",
    "  <string>APPL</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export function resolveDesktopIconPath(
  platform: NodeJS.Platform = process.platform,
  homedir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (platform === "win32") {
    const folder = env.USERPROFILE ? path.join(env.USERPROFILE, "Desktop") : path.join(homedir, "Desktop");
    return path.join(folder, "Todero.lnk");
  }
  if (platform === "darwin") {
    const systemApps = path.join("/Applications", "Todero.app");
    try {
      if (fs.existsSync("/Applications")) {
        fs.accessSync("/Applications", fs.constants.W_OK);
        return systemApps;
      }
    } catch {
    }
    return path.join(homedir, "Applications", "Todero.app");
  }
  return null;
}

function writeUnixLauncher(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, posixStartScript(), { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function createWindowsShortcut(lnkPath: string, launcherPath: string): void {
  fs.mkdirSync(path.dirname(lnkPath), { recursive: true });
  const psCmd = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut(${JSON.stringify(lnkPath)})`,
    `$s.TargetPath = ${JSON.stringify(launcherPath)}`,
    `$s.WorkingDirectory = ${JSON.stringify(path.dirname(launcherPath))}`,
    `$s.WindowStyle = 1`,
    `$s.Description = "Start Todero"`,
    `$s.Save()`,
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCmd], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createMacApp(appPath: string): void {
  const macOsDir = path.join(appPath, "Contents", "MacOS");
  const contentsDir = path.join(appPath, "Contents");
  fs.mkdirSync(macOsDir, { recursive: true });
  fs.writeFileSync(path.join(contentsDir, "Info.plist"), macAppInfoPlist());
  writeUnixLauncher(path.join(macOsDir, "Todero"));
}

export function installOnboardDesktopIcon(options?: {
  platform?: NodeJS.Platform;
  homedir?: string;
  env?: NodeJS.ProcessEnv;
  settingsDir?: string;
}): string | null {
  const platform = options?.platform ?? process.platform;
  const homedir = options?.homedir ?? os.homedir();
  const env = options?.env ?? process.env;
  const settingsDir = options?.settingsDir ?? resolveOnboardSettingsDir(env);
  const iconPath = resolveDesktopIconPath(platform, homedir, env);
  if (!iconPath) return null;
  if (platform === "win32") {
    const launcherPath = path.join(settingsDir, "bin", "start-todero.cmd");
    fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
    fs.writeFileSync(launcherPath, windowsStartScript());
    try {
      createWindowsShortcut(iconPath, launcherPath);
      return iconPath;
    } catch {
      const batPath = path.join(path.dirname(iconPath), "Todero.bat");
      fs.copyFileSync(launcherPath, batPath);
      return batPath;
    }
  }
  if (platform === "darwin") {
    createMacApp(iconPath);
    return iconPath;
  }
  return null;
}


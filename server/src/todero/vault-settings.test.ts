import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAGIC_POSIX_RECOMMENDED_VAULT_PATH,
  MAGIC_WINDOWS_RECOMMENDED_VAULT_PATH,
  RECOMMENDED_VAULT_REPO_URL,
  defaultRecommendedVaultPath,
  ensureRecommendedVault,
  getVaultReadPath,
  getVaultSettings,
  resolveRecommendedVaultPath,
  saveVaultSettings,
  vaultPathExists,
} from "./vault-settings.js";

function envWithoutVaultDir(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.TODERO_VAULT_DIR;
  return env;
}

describe("defaultRecommendedVaultPath", () => {
  it("uses the app-owned ~/.todero/todero-brain folder, not magic Windows/POSIX paths", () => {
    const env = envWithoutVaultDir();
    delete env.TODERO_SETTINGS_DIR;
    const expected = path.join(os.homedir(), ".todero", "todero-brain");
    expect(defaultRecommendedVaultPath("win32", env)).toBe(expected);
    expect(defaultRecommendedVaultPath("linux", env)).toBe(expected);
    expect(defaultRecommendedVaultPath("darwin", env)).toBe(expected);
    expect(defaultRecommendedVaultPath("win32", env)).not.toBe(MAGIC_WINDOWS_RECOMMENDED_VAULT_PATH);
    expect(defaultRecommendedVaultPath("linux", env)).not.toBe(MAGIC_POSIX_RECOMMENDED_VAULT_PATH);
    expect(defaultRecommendedVaultPath("linux", env)).not.toBe("/workspace/Mich-Brain2");
    expect(resolveRecommendedVaultPath(env, "win32")).toBe(expected);
    expect(resolveRecommendedVaultPath(env, "linux")).toBe(expected);
  });

  it("nests todero-brain under TODERO_SETTINGS_DIR when set", () => {
    const settingsDir = path.join(os.tmpdir(), "todero-settings-app-owned");
    const recommendedPath = defaultRecommendedVaultPath("linux", { TODERO_SETTINGS_DIR: settingsDir });
    expect(recommendedPath).toBe(path.join(settingsDir, "todero-brain"));
    expect(recommendedPath).not.toBe(MAGIC_POSIX_RECOMMENDED_VAULT_PATH);
    expect(recommendedPath).not.toBe(MAGIC_WINDOWS_RECOMMENDED_VAULT_PATH);
  });

  it("uses TODERO_VAULT_DIR override when set", () => {
    const override = "D:\\custom-vault";
    const recommendedPath = resolveRecommendedVaultPath(
      { ...process.env, TODERO_VAULT_DIR: override },
      "win32",
    );
    expect(recommendedPath).toBe(override);
  });

  it("ignores blank TODERO_VAULT_DIR and falls back to the app-owned default", () => {
    const env = { TODERO_VAULT_DIR: "  " };
    expect(resolveRecommendedVaultPath(env, "win32")).toBe(defaultRecommendedVaultPath("win32", env));
    expect(resolveRecommendedVaultPath(env, "win32")).not.toBe(MAGIC_WINDOWS_RECOMMENDED_VAULT_PATH);
  });

  it("does not fall back to Mich-Brain2 on linux or darwin", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const recommendedPath = resolveRecommendedVaultPath(envWithoutVaultDir(), platform);
      expect(recommendedPath).not.toBe("/workspace/Mich-Brain2");
      expect(defaultRecommendedVaultPath(platform)).not.toBe("/workspace/Mich-Brain2");
      expect(recommendedPath).not.toBe(MAGIC_POSIX_RECOMMENDED_VAULT_PATH);
    }
  });

  it("does not treat a missing recommended folder as attached", () => {
    expect(vaultPathExists(path.join(os.tmpdir(), "todero-brain-missing-folder"))).toBe(false);
    expect(vaultPathExists("")).toBe(false);
  });
});

describe("ensureRecommendedVault", () => {
  let tmp: string;
  let prevSettings: string | undefined;
  let prevVaultDir: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "todero-vault-"));
    prevSettings = process.env.TODERO_SETTINGS_DIR;
    prevVaultDir = process.env.TODERO_VAULT_DIR;
    process.env.TODERO_SETTINGS_DIR = tmp;
    delete process.env.TODERO_VAULT_DIR;
  });

  afterEach(() => {
    if (prevSettings === undefined) delete process.env.TODERO_SETTINGS_DIR;
    else process.env.TODERO_SETTINGS_DIR = prevSettings;
    if (prevVaultDir === undefined) delete process.env.TODERO_VAULT_DIR;
    else process.env.TODERO_VAULT_DIR = prevVaultDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("clones the public repo when the app-owned folder is missing, then attaches", () => {
    const dest = path.join(tmp, "todero-brain");
    expect(fs.existsSync(dest)).toBe(false);
    const gitExec = vi.fn((args: readonly string[]) => {
      if (args[0] === "clone") {
        expect(args[1]).toBe(RECOMMENDED_VAULT_REPO_URL);
        expect(args[2]).toBe(dest);
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "README.md"), "brain\n");
        return;
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    });

    const ensured = ensureRecommendedVault({ gitExec });
    expect(ensured).toBe(dest);
    expect(gitExec).toHaveBeenCalledWith(["clone", RECOMMENDED_VAULT_REPO_URL, dest]);

    const row = saveVaultSettings({ source: "recommended" }, { gitExec: () => undefined });
    expect(row.source).toBe("recommended");
    expect(row.path).toBe(dest);
    expect(getVaultReadPath()).toBe(dest);
  });

  it("git-pulls when the app-owned clone is already present", () => {
    const dest = path.join(tmp, "todero-brain");
    fs.mkdirSync(path.join(dest, ".git"), { recursive: true });
    const gitExec = vi.fn();
    expect(ensureRecommendedVault({ gitExec })).toBe(dest);
    expect(gitExec).toHaveBeenCalledWith(["-C", dest, "pull"]);
    expect(gitExec).not.toHaveBeenCalledWith(expect.arrayContaining(["clone"]));
  });

  it("does not attach Recommended when git fails", () => {
    const dest = path.join(tmp, "todero-brain");
    const gitExec = vi.fn(() => {
      throw new Error("fatal: unable to access https://github.com/nabitllc/todero-brain.git");
    });
    expect(() => saveVaultSettings({ source: "recommended" }, { gitExec })).toThrow(
      /Failed to clone Recommended Second Brain|unable to access/,
    );
    expect(getVaultSettings()).toBeNull();
    expect(getVaultReadPath()).toBeNull();
    expect(vaultPathExists(dest)).toBe(false);
  });
});

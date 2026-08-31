import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_VAULT_REPO_URL,
  assertOnboardPrerequisites,
  ensureOnboardRecommendedVault,
  installOnboardDesktopIcon,
  missingOnboardPrerequisites,
  posixStartScript,
  resolveDesktopIconPath,
  resolveOnboardRecommendedVaultPath,
  windowsStartScript,
} from "../onboard-extras.js";

describe("onboard extras", () => {
  it("reports a single missing-tool error", () => {
    const env = { PATH: "" };
    expect(missingOnboardPrerequisites({ env, platform: "linux" })).toEqual(["node", "git", "pnpm"]);
    expect(() => assertOnboardPrerequisites({ env, platform: "linux" })).toThrow(/Missing: node, git, pnpm/);
  });

  it("clones the recommended vault into the app-owned folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "todero-onboard-vault-"));
    const env = { TODERO_SETTINGS_DIR: root };
    const calls: string[][] = [];
    const dest = ensureOnboardRecommendedVault({
      env,
      gitExec: (args) => {
        calls.push([...args]);
        if (args[0] === "clone") fs.mkdirSync(args[2], { recursive: true });
      },
    });
    expect(dest).toBe(path.join(root, "todero-brain"));
    expect(dest).not.toContain("Mich-Brain2");
    expect(calls[0]).toEqual(["clone", RECOMMENDED_VAULT_REPO_URL, dest]);
    const saved = JSON.parse(fs.readFileSync(path.join(root, "vault-settings.json"), "utf8"));
    expect(saved.source).toBe("recommended");
    expect(saved.path).toBe(dest);
  });

  it("uses the app-owned todero-brain folder", () => {
    expect(resolveOnboardRecommendedVaultPath({ TODERO_SETTINGS_DIR: "/tmp/settings-home" })).toBe(
      path.join("/tmp/settings-home", "todero-brain"),
    );
  });

  it("creates a Windows Desktop shortcut fallback and a Mac Applications app", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "todero-onboard-icon-"));
    const winHome = path.join(root, "win-home");
    const macHome = path.join(root, "mac-home");
    fs.mkdirSync(path.join(winHome, "Desktop"), { recursive: true });
    const winIcon = installOnboardDesktopIcon({
      platform: "win32",
      homedir: winHome,
      env: { USERPROFILE: winHome },
      settingsDir: path.join(root, "settings"),
    });
    expect(winIcon).toBe(path.join(winHome, "Desktop", "Todero.bat"));
    expect(fs.existsSync(winIcon!)).toBe(true);
    expect(windowsStartScript()).toMatch(/todero run/);
    const macIcon = installOnboardDesktopIcon({
      platform: "darwin",
      homedir: macHome,
      env: {},
      settingsDir: path.join(root, "settings"),
    });
    expect(macIcon).toBe(path.join(macHome, "Applications", "Todero.app"));
    expect(fs.existsSync(path.join(macIcon!, "Contents", "MacOS", "Todero"))).toBe(true);
    expect(posixStartScript()).toMatch(/todero run/);
    expect(resolveDesktopIconPath("linux", macHome)).toBeNull();
  });
});

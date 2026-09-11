import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCanonicalWorktreeSeedSource } from "./worktree-seed-source.js";

const cleanup: string[] = [];

/**
 * Windows refuses an ordinary symlink unless the shell is elevated or
 * Developer Mode is on, and never refuses a junction — which carries the same
 * lstat/stat behaviour these cases are about (a link, and ENOENT when what it
 * points at is not there). Detected at runtime by trying the real thing first,
 * so a machine that can make symlinks still tests symlinks.
 */
function makeLink(target: string, linkPath: string): void {
  try {
    fs.symlinkSync(target, linkPath);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err;
  }
  fs.symlinkSync(target, linkPath, "junction");
}

function makeInstance(prefix: string, instanceId: string) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(cwd);
  const configDir = path.join(cwd, ".todero");
  const configPath = path.join(configDir, "config.json");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, "{}\n");
  fs.writeFileSync(path.join(configDir, ".env"), `PAPERCLIP_INSTANCE_ID=${instanceId}\n`);
  return { cwd, configPath, instanceId };
}

/**
 * A control plane's own instance root: `<home>/instances/<id>/config.json`, which
 * names its instance by directory and has no adjacent .env.
 */
function makeInstanceRoot(instanceId: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "todero-seed-home-"));
  cleanup.push(home);
  const configDir = path.join(home, "instances", instanceId);
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.json");
  fs.writeFileSync(configPath, "{}\n");
  return { configPath, instanceId };
}

/** A managed project checkout: a plain clone with no `.todero` of its own. */
function makePlainCheckout() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "todero-seed-checkout-"));
  cleanup.push(cwd);
  return cwd;
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolveCanonicalWorktreeSeedSource", () => {
  it("returns only the registered base workspace config", () => {
    const source = makeInstance("todero-seed-source-", "source-instance");
    const target = makeInstance("todero-seed-target-", "target-instance");

    expect(resolveCanonicalWorktreeSeedSource({
      registeredBaseWorkspaceCwd: source.cwd,
      targetConfigPath: target.configPath,
      expectedTargetInstanceId: target.instanceId,
      manifestSource: { configPath: source.configPath, instanceId: source.instanceId },
      manifestTargetInstanceId: target.instanceId,
    })).toMatchObject({
      baseWorkspaceCwd: source.cwd,
      configPath: source.configPath,
      targetConfigPath: target.configPath,
    });
  });

  it("takes the named source when the base workspace carries no config of its own", () => {
    const baseCwd = makePlainCheckout();
    const source = makeInstanceRoot("default");
    const target = makeInstance("todero-seed-target-", "target-instance");

    expect(resolveCanonicalWorktreeSeedSource({
      registeredBaseWorkspaceCwd: baseCwd,
      explicitSourceConfigPath: source.configPath,
      targetConfigPath: target.configPath,
      expectedTargetInstanceId: target.instanceId,
      manifestSource: { configPath: source.configPath, instanceId: source.instanceId },
      manifestTargetInstanceId: target.instanceId,
    })).toMatchObject({
      baseWorkspaceCwd: baseCwd,
      configPath: source.configPath,
      instanceId: "default",
    });
  });

  it("rejects a dangling config symlink instead of falling back to the named source", () => {
    const baseCwd = makePlainCheckout();
    fs.mkdirSync(path.join(baseCwd, ".todero"), { recursive: true });
    makeLink(path.join(baseCwd, "absent.json"), path.join(baseCwd, ".todero", "config.json"));
    const source = makeInstanceRoot("default");
    const target = makeInstance("todero-seed-dangling-target-", "target-instance");

    expect(() => resolveCanonicalWorktreeSeedSource({
      registeredBaseWorkspaceCwd: baseCwd,
      explicitSourceConfigPath: source.configPath,
      targetConfigPath: target.configPath,
      expectedTargetInstanceId: target.instanceId,
      manifestSource: { configPath: source.configPath, instanceId: source.instanceId },
      manifestTargetInstanceId: target.instanceId,
    })).toThrow(/Registered source Todero config does not exist/);
  });

  // Windows reports ENOENT, not ENOTDIR, for a path underneath a regular file,
  // so the config probe alone cannot tell a malformed workspace from a plain
  // checkout. The resolver decides on the `.todero` entry itself, which fails
  // closed on both platforms — so this case runs everywhere.
  it("fails closed when the declared config cannot be inspected", () => {
    const baseCwd = makePlainCheckout();
    // `.todero` as a regular file: nothing can live under it, whatever errno
    // the platform reports for the path below it.
    fs.writeFileSync(path.join(baseCwd, ".todero"), "not a directory\n");
    const source = makeInstanceRoot("default");
    const target = makeInstance("todero-seed-unreadable-target-", "target-instance");

    expect(() => resolveCanonicalWorktreeSeedSource({
      registeredBaseWorkspaceCwd: baseCwd,
      explicitSourceConfigPath: source.configPath,
      targetConfigPath: target.configPath,
      expectedTargetInstanceId: target.instanceId,
      manifestSource: { configPath: source.configPath, instanceId: source.instanceId },
      manifestTargetInstanceId: target.instanceId,
    })).toThrow(/cannot be inspected \(ENOTDIR\)/);
  });

  it("rejects a dangling .todero symlink instead of falling back to the named source", () => {
    const baseCwd = makePlainCheckout();
    // Resolving `.todero` fails before the probe reaches config.json, so the config
    // entry reports ENOENT even though this workspace is malformed rather than plain.
    makeLink(path.join(baseCwd, "absent-dir"), path.join(baseCwd, ".todero"));
    const source = makeInstanceRoot("default");
    const target = makeInstance("todero-seed-dangling-parent-target-", "target-instance");

    expect(() => resolveCanonicalWorktreeSeedSource({
      registeredBaseWorkspaceCwd: baseCwd,
      explicitSourceConfigPath: source.configPath,
      targetConfigPath: target.configPath,
      expectedTargetInstanceId: target.instanceId,
      manifestSource: { configPath: source.configPath, instanceId: source.instanceId },
      manifestTargetInstanceId: target.instanceId,
    })).toThrow(/cannot be inspected \(ENOENT on its \.todero symlink target\)/);
  });

  it("takes the named source when .todero is a symlink to a directory with no config", () => {
    const baseCwd = makePlainCheckout();
    const linked = path.join(baseCwd, "linked-config-dir");
    fs.mkdirSync(linked, { recursive: true });
    makeLink(linked, path.join(baseCwd, ".todero"));
    const source = makeInstanceRoot("default");
    const target = makeInstance("todero-seed-linked-empty-target-", "target-instance");

    const resolved = resolveCanonicalWorktreeSeedSource({
      registeredBaseWorkspaceCwd: baseCwd,
      explicitSourceConfigPath: source.configPath,
      targetConfigPath: target.configPath,
      expectedTargetInstanceId: target.instanceId,
      manifestSource: { configPath: source.configPath, instanceId: source.instanceId },
      manifestTargetInstanceId: target.instanceId,
    });

    expect(resolved.configPath).toBe(source.configPath);
    expect(resolved.instanceId).toBe("default");
  });

  it("fails closed when the base workspace carries no config and none is named", () => {
    const baseCwd = makePlainCheckout();
    const target = makeInstance("todero-seed-unnamed-target-", "target-instance");

    expect(() => resolveCanonicalWorktreeSeedSource({
      registeredBaseWorkspaceCwd: baseCwd,
      targetConfigPath: target.configPath,
      expectedTargetInstanceId: target.instanceId,
      manifestSource: { configPath: target.configPath, instanceId: target.instanceId },
      manifestTargetInstanceId: target.instanceId,
    })).toThrow(/no Todero config of its own/);
  });

  it("fails closed without registration and when source equals target", () => {
    const target = makeInstance("todero-seed-same-target-", "target-instance");
    const diagnostic = { configPath: target.configPath, instanceId: target.instanceId };

    expect(() => resolveCanonicalWorktreeSeedSource({
      targetConfigPath: target.configPath,
      expectedTargetInstanceId: target.instanceId,
      manifestSource: diagnostic,
      manifestTargetInstanceId: target.instanceId,
    })).toThrow(/not registered/);

    expect(() => resolveCanonicalWorktreeSeedSource({
      registeredBaseWorkspaceCwd: target.cwd,
      targetConfigPath: target.configPath,
      expectedTargetInstanceId: target.instanceId,
      manifestSource: diagnostic,
      manifestTargetInstanceId: target.instanceId,
    })).toThrow(/same canonical file/);
  });
});

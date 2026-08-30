import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

import { createSdkDirectoryLink, linkSdkInto, readPluginsUnder } from "./link-plugin-dev-sdk.mjs";

let workDir;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "link-plugin-dev-sdk-"));
});

after(() => {
  rmSync(workDir, { force: true, recursive: true });
});

function makePackage(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}\n");
  return dir;
}

test("readPluginsUnder returns [] for a missing directory", () => {
  assert.deepEqual(readPluginsUnder(join(workDir, "does-not-exist")), []);
});

test("readPluginsUnder finds first-level package directories", () => {
  const parent = join(workDir, "first-level");
  const a = makePackage(join(parent, "a"));
  const b = makePackage(join(parent, "b"));

  assert.deepEqual(readPluginsUnder(parent).sort(), [a, b].sort());
});

test("readPluginsUnder recurses into directories that are not themselves packages", () => {
  // Mirrors the recursive pnpm-workspace exclusion glob: a provider nested
  // deeper than one level must still be discovered.
  const parent = join(workDir, "nested");
  const nested = makePackage(join(parent, "vendor", "my-plugin"));

  assert.deepEqual(readPluginsUnder(parent), [nested]);
});

test("readPluginsUnder stops descending once a package.json is found and skips node_modules", () => {
  const parent = join(workDir, "boundaries");
  const pkg = makePackage(join(parent, "plugin"));
  // A nested package inside an already-matched package must not be returned.
  makePackage(join(pkg, "sub-package"));
  // node_modules must be ignored entirely.
  makePackage(join(parent, "node_modules", "some-dep"));

  assert.deepEqual(readPluginsUnder(parent), [pkg]);
});

test("linkSdkInto creates the plugin-sdk symlink and is idempotent", () => {
  const pkg = makePackage(join(workDir, "link-target"));

  assert.equal(linkSdkInto(pkg), true);

  const link = join(pkg, "node_modules", "@todero", "plugin-sdk");
  assert.ok(lstatSync(link).isSymbolicLink());

  // Second call is a no-op because the link already points at the in-repo SDK.
  assert.equal(linkSdkInto(pkg), false);
});

test("linkSdkInto leaves a real (non-symlink) install in place", () => {
  const pkg = makePackage(join(workDir, "real-install"));
  const scopeDir = join(pkg, "node_modules", "@todero");
  mkdirSync(scopeDir, { recursive: true });
  // Simulate a published-tarball install: a real directory, not a symlink.
  makePackage(join(scopeDir, "plugin-sdk"));

  assert.equal(linkSdkInto(pkg), false);
  assert.ok(!lstatSync(join(scopeDir, "plugin-sdk")).isSymbolicLink());
});

test("linkSdkInto replaces a symlink that points somewhere else", () => {
  const pkg = makePackage(join(workDir, "stale-link"));
  const scopeDir = join(pkg, "node_modules", "@todero");
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync("../somewhere-else", join(scopeDir, "plugin-sdk"), "dir");

  assert.equal(linkSdkInto(pkg), true);
  assert.notEqual(readlinkSync(join(scopeDir, "plugin-sdk")), "../somewhere-else");
  assert.ok(existsSync(scopeDir));
});

test("linkSdkInto treats an absolute SDK target as already linked", () => {
  const pkg = makePackage(join(workDir, "abs-link"));
  assert.equal(linkSdkInto(pkg), true);
  const link = join(pkg, "node_modules", "@todero", "plugin-sdk");
  const absTarget = resolve(join(pkg, "node_modules", "@todero"), readlinkSync(link));
  unlinkSync(link);
  symlinkSync(absTarget, link, "dir");
  assert.equal(linkSdkInto(pkg), false);
});

test("createSdkDirectoryLink uses dir on non-Windows", () => {
  const calls = [];
  const symlink = (target, path, type) => {
    calls.push({ target, path, type });
  };
  const kind = createSdkDirectoryLink("../sdk", "/tmp/plugin-sdk-link", {
    platform: "linux",
    symlink,
  });
  assert.equal(kind, "symlink");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "dir");
});

test("createSdkDirectoryLink uses junction on win32", () => {
  const calls = [];
  const symlink = (target, path, type) => {
    calls.push({ target, path, type });
  };
  const kind = createSdkDirectoryLink("../sdk", "/tmp/plugin-sdk-link", {
    platform: "win32",
    symlink,
  });
  assert.equal(kind, "junction");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "junction");
  assert.equal(calls[0].target, "../sdk");
});

test("createSdkDirectoryLink falls back to dir then copy on win32", () => {
  const types = [];
  const symlink = (_target, _path, type) => {
    types.push(type);
    const err = new Error("EPERM: operation not permitted, symlink");
    err.code = "EPERM";
    throw err;
  };
  let copied = null;
  const copy = (src, dest, opts) => {
    copied = { src, dest, opts };
  };
  const kind = createSdkDirectoryLink("../sdk", "/tmp/scope/plugin-sdk", {
    platform: "win32",
    symlink,
    copy,
  });
  assert.equal(kind, "copy");
  assert.deepEqual(types, ["junction", "dir"]);
  assert.equal(copied.dest, "/tmp/scope/plugin-sdk");
  assert.equal(copied.opts.recursive, true);
});

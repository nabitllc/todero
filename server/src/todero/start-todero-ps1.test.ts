import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/start-todero.ps1",
);

describe("start-todero.ps1 Brain update", () => {
  const script = fs.readFileSync(scriptPath, "utf8");

  it("does not Fail when C:\\Development\\Todero Brain is missing", () => {
    expect(script).not.toMatch(/Fail\s+"Todero Brain checkout not found/);
    expect(script).not.toContain('$Brain = "C:\\Development\\Todero Brain"');
  });

  it("clones or pulls the public repo into the app-owned ~/.todero/todero-brain folder", () => {
    expect(script).toContain('Join-Path $env:USERPROFILE ".todero\\todero-brain"');
    expect(script).toContain("https://github.com/nabitllc/todero-brain.git");
    expect(script).toContain("git clone $BrainRepo $Brain");
    expect(script).toContain("git -C $Brain pull");
  });

  it("skips Brain update with a clear line instead of failing the start script", () => {
    expect(script).toMatch(/Skipping Todero Brain update:/);
  });
});

describe("start-todero.ps1 start path", () => {
  const script = fs.readFileSync(scriptPath, "utf8");

  it("installs local deps on every start", () => {
    expect(script.includes("needInstall")).toBe(false);
    expect(script).toMatch(/git pull failed/);
    expect(script).toMatch(/LASTEXITCODE/);
  });

  it("asks to close other windows when embedded Postgres is busy", () => {
    expect(script).toContain("$PgPort = 54330");
    expect(script).toContain("Test-Listening -ListenPort $PgPort");
    expect(script).toContain("Close other Todero windows, then retry.");
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCodexSkills,
  syncCodexSkills,
} from "@todero/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("codex local skill sync", () => {
  const toderoKey = "nabitllc/todero/todero";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("defaults the operational Todero skill for workspace injection on the next run", async () => {
    const codexHome = await makeTempDir("todero-codex-skill-sync-");
    cleanupDirs.add(codexHome);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
      },
    } as const;

    const before = await listCodexSkills(ctx);
    expect(before.mode).toBe("ephemeral");
    expect(before.desiredSkills).toContain(toderoKey);
    expect(before.entries.find((entry) => entry.key === toderoKey)?.state).toBe("configured");
    expect(before.entries.find((entry) => entry.key === toderoKey)?.detail).toContain("CODEX_HOME/skills/");
  });

  it("does not apply the legacy operational skill default to the native runner", async () => {
    const snapshot = await listCodexSkills({
      agentId: "agent-native",
      companyId: "company-1",
      adapterType: "paperclip_runner",
      config: {},
    });

    expect(snapshot.adapterType).toBe("paperclip_runner");
    expect(snapshot.desiredSkills).toEqual([]);
    expect(snapshot.entries.find((entry) => entry.key === toderoKey)?.state).toBe("available");
  });

  it("does not persist Todero skills into CODEX_HOME during sync", async () => {
    const codexHome = await makeTempDir("todero-codex-skill-prune-");
    cleanupDirs.add(codexHome);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        toderoSkillSync: {
          desiredSkills: [toderoKey],
        },
      },
    } as const;

    const after = await syncCodexSkills(configuredCtx, [toderoKey]);
    expect(after.mode).toBe("ephemeral");
    expect(after.entries.find((entry) => entry.key === toderoKey)?.state).toBe("configured");
    await expect(fs.lstat(path.join(codexHome, "skills", "todero"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("normalizes legacy flat Todero skill refs before reporting configured state", async () => {
    const codexHome = await makeTempDir("todero-codex-legacy-skill-sync-");
    cleanupDirs.add(codexHome);

    const snapshot = await listCodexSkills({
      agentId: "agent-3",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        toderoSkillSync: {
          desiredSkills: ["todero"],
        },
      },
    });

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.desiredSkills).toContain(toderoKey);
    expect(snapshot.desiredSkills).not.toContain("todero");
    expect(snapshot.entries.find((entry) => entry.key === toderoKey)?.state).toBe("configured");
    expect(snapshot.entries.find((entry) => entry.key === "todero")).toBeUndefined();
  });
});

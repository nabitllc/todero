import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCodexSkillsInjected } from "@todero/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createToderoRepoSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "server"), { recursive: true });
  await fs.mkdir(path.join(root, "packages", "adapter-utils"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", skillName), { recursive: true });
  await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), '{"name":"todero"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

async function createCustomSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "custom", skillName), { recursive: true });
  await fs.writeFile(
    path.join(root, "custom", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

describe("codex local adapter skill injection", () => {
  const toderoKey = "nabitllc/todero/todero";
  const createAgentKey = "nabitllc/todero/todero-create-agent";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("repairs a Codex Todero skill symlink that still points at another live checkout", async () => {
    const currentRepo = await makeTempDir("todero-codex-current-");
    const oldRepo = await makeTempDir("todero-codex-old-");
    const skillsHome = await makeTempDir("todero-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createToderoRepoSkill(currentRepo, "todero");
    await createToderoRepoSkill(currentRepo, "todero-create-agent");
    await createToderoRepoSkill(oldRepo, "todero");
    await fs.symlink(path.join(oldRepo, "skills", "todero"), path.join(skillsHome, "todero"));

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [
          {
            key: toderoKey,
            runtimeName: "todero",
            source: path.join(currentRepo, "skills", "todero"),
          },
          {
            key: createAgentKey,
            runtimeName: "todero-create-agent",
            source: path.join(currentRepo, "skills", "todero-create-agent"),
          },
        ],
      },
    );

    expect(await fs.realpath(path.join(skillsHome, "todero"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "todero")),
    );
    expect(await fs.realpath(path.join(skillsHome, "todero-create-agent"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "todero-create-agent")),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Repaired Codex skill "todero"'),
      }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Injected Codex skill "todero-create-agent"'),
      }),
    );
  });

  it("preserves a custom Codex skill symlink outside Todero repo checkouts", async () => {
    const currentRepo = await makeTempDir("todero-codex-current-");
    const customRoot = await makeTempDir("todero-codex-custom-");
    const skillsHome = await makeTempDir("todero-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(customRoot);
    cleanupDirs.add(skillsHome);

    await createToderoRepoSkill(currentRepo, "todero");
    await createCustomSkill(customRoot, "todero");
    await fs.symlink(path.join(customRoot, "custom", "todero"), path.join(skillsHome, "todero"));

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: toderoKey,
        runtimeName: "todero",
        source: path.join(currentRepo, "skills", "todero"),
      }],
    });

    expect(await fs.realpath(path.join(skillsHome, "todero"))).toBe(
      await fs.realpath(path.join(customRoot, "custom", "todero")),
    );
  });

  it("prunes broken symlinks for unavailable Todero repo skills before Codex starts", async () => {
    const currentRepo = await makeTempDir("todero-codex-current-");
    const oldRepo = await makeTempDir("todero-codex-old-");
    const skillsHome = await makeTempDir("todero-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createToderoRepoSkill(currentRepo, "todero");
    await createToderoRepoSkill(oldRepo, "agent-browser");
    const staleTarget = path.join(oldRepo, "skills", "agent-browser");
    await fs.symlink(staleTarget, path.join(skillsHome, "agent-browser"));
    await fs.rm(staleTarget, { recursive: true, force: true });

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [{
          key: toderoKey,
          runtimeName: "todero",
          source: path.join(currentRepo, "skills", "todero"),
        }],
      },
    );

    await expect(fs.lstat(path.join(skillsHome, "agent-browser"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Removed stale Codex skill "agent-browser"'),
      }),
    );
  });

  it("preserves other live Todero skill symlinks in the shared workspace skill directory", async () => {
    const currentRepo = await makeTempDir("todero-codex-current-");
    const skillsHome = await makeTempDir("todero-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createToderoRepoSkill(currentRepo, "todero");
    await createToderoRepoSkill(currentRepo, "agent-browser");
    await fs.symlink(
      path.join(currentRepo, "skills", "agent-browser"),
      path.join(skillsHome, "agent-browser"),
    );

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: toderoKey,
        runtimeName: "todero",
        source: path.join(currentRepo, "skills", "todero"),
      }],
    });

    expect((await fs.lstat(path.join(skillsHome, "todero"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "agent-browser"))).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(path.join(skillsHome, "agent-browser"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "agent-browser")),
    );
  });
});

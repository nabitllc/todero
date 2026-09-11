import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CompanySkill } from "@todero/shared";
import {
  buildAgentBrief,
  readAgentFolder,
  resolveAgentBriefPath,
  resolveAgentDocumentsDir,
  resolveAgentFolderRoot,
  resolveAgentSkillsDir,
  syncAgentSkillFolder,
  toAgentFolderFileSlug,
  writeAgentHandIn,
} from "./agent-folder.js";

const COMPANY_ID = "company-1";
const AGENT_ID = "agent-1";

let homeDir: string;
let previousHome: string | undefined;

beforeEach(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "todero-agent-folder-"));
  previousHome = process.env.TODERO_HOME;
  process.env.TODERO_HOME = homeDir;
  delete process.env.PAPERCLIP_HOME;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.TODERO_HOME;
  else process.env.TODERO_HOME = previousHome;
  await fs.rm(homeDir, { recursive: true, force: true });
});

function packSkill(slug: string, markdown: string, overrides: Partial<CompanySkill> = {}): CompanySkill {
  return {
    id: slug,
    companyId: COMPANY_ID,
    key: `company/${COMPANY_ID}/${slug}`,
    slug,
    name: slug,
    description: null,
    markdown,
    sourceType: "local_path",
    sourceLocator: null,
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [],
    iconUrl: null,
    color: null,
    tagline: null,
    authorName: null,
    homepageUrl: null,
    categories: [],
    sharingScope: "company",
    publicShareToken: null,
    forkedFromSkillId: null,
    forkedFromCompanyId: null,
    starCount: 0,
    installCount: 0,
    forkCount: 0,
    currentVersionId: null,
    metadata: { "todero-task-kinds": "all", "todero-priority": 1 },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as CompanySkill;
}

const AGENT = {
  id: AGENT_ID,
  companyId: COMPANY_ID,
  name: "Ada",
  title: "Lead",
  adapterConfig: {
    toderoSkillSync: {
      desiredSkills: [`company/${COMPANY_ID}/plan`, `company/${COMPANY_ID}/tone`],
    },
  },
};

describe("folder paths", () => {
  it("sits beside the instructions bundle under the instance root", () => {
    const root = resolveAgentFolderRoot(COMPANY_ID, AGENT_ID);
    expect(root).toBe(path.resolve(homeDir, "instances", "default", "companies", COMPANY_ID, "agents", AGENT_ID));
    expect(resolveAgentBriefPath(COMPANY_ID, AGENT_ID)).toBe(path.join(root, "brief.md"));
    expect(resolveAgentSkillsDir(COMPANY_ID, AGENT_ID)).toBe(path.join(root, "skills"));
    expect(resolveAgentDocumentsDir(COMPANY_ID, AGENT_ID)).toBe(path.join(root, "documents"));
  });
});

describe("toAgentFolderFileSlug", () => {
  it("keeps a file name safe on every platform", () => {
    expect(toAgentFolderFileSlug("ZZW-12", "x")).toBe("zzw-12");
    expect(toAgentFolderFileSlug("Draft the / brief?", "x")).toBe("draft-the-brief");
  });

  it("falls back when nothing usable is left", () => {
    expect(toAgentFolderFileSlug("///", "hand-in")).toBe("hand-in");
    expect(toAgentFolderFileSlug("", "hand-in")).toBe("hand-in");
  });

  it("steps around the names Windows will not give a file", () => {
    expect(toAgentFolderFileSlug("NUL", "hand-in")).toBe("nul-file");
    expect(toAgentFolderFileSlug("com1", "hand-in")).toBe("com1-file");
    expect(toAgentFolderFileSlug("Con", "hand-in")).toBe("con-file");
    expect(toAgentFolderFileSlug("console", "hand-in")).toBe("console");
  });
});

describe("buildAgentBrief", () => {
  it("names the agent, the mission and what it reads first", () => {
    const brief = buildAgentBrief({
      agentName: "Ada",
      roleTitle: "Lead",
      companyName: "Acme",
      mission: "Ship the thing.",
      skillNames: ["todero-plan-a-project", "todero-talk-like-a-colleague"],
    });
    expect(brief).toContain("# Ada");
    expect(brief).toContain("Ada, Lead at Acme");
    expect(brief).toContain("Ship the thing.");
    expect(brief).toContain("## What this agent knows");
    expect(brief).toContain("- todero-plan-a-project");
  });

  it("says so plainly when nothing is turned on", () => {
    const brief = buildAgentBrief({ agentName: "Ada", skillNames: [] });
    expect(brief).toContain("Nothing is turned on for this agent yet.");
  });

  it("never uses the words a person should not have to read", () => {
    const brief = buildAgentBrief({
      agentName: "Ada",
      mission: "Ship the thing.",
      skillNames: ["todero-plan-a-project"],
    }).toLowerCase();
    for (const banned of ["prompt", "injection", "task kind", "system message", "heartbeat"]) {
      expect(brief).not.toContain(banned);
    }
  });
});

describe("syncAgentSkillFolder", () => {
  const skills = [
    packSkill("plan", "---\nname: plan\n---\n\nHow to plan.\n"),
    packSkill("tone", "---\nname: tone\n---\n\nHow to talk.\n"),
    packSkill("unused", "---\nname: unused\n---\n\nNot turned on.\n"),
  ];

  it("writes the brief and a copy of everything turned on", async () => {
    const result = await syncAgentSkillFolder({ agent: AGENT, companySkills: skills, companyName: "Acme" });
    expect(result.changed).toBe(true);
    expect(result.skillFiles).toEqual(["plan.md", "tone.md"]);

    const brief = await fs.readFile(resolveAgentBriefPath(COMPANY_ID, AGENT_ID), "utf8");
    expect(brief).toContain("- plan");
    expect(await fs.readFile(path.join(resolveAgentSkillsDir(COMPANY_ID, AGENT_ID), "plan.md"), "utf8"))
      .toContain("How to plan.");
    await expect(fs.stat(path.join(resolveAgentSkillsDir(COMPANY_ID, AGENT_ID), "unused.md"))).rejects.toThrow();
  });

  it("creates the documents folder so a hand-in has somewhere to land", async () => {
    await syncAgentSkillFolder({ agent: AGENT, companySkills: skills });
    expect((await fs.stat(resolveAgentDocumentsDir(COMPANY_ID, AGENT_ID))).isDirectory()).toBe(true);
  });

  it("changes nothing on a second run", async () => {
    await syncAgentSkillFolder({ agent: AGENT, companySkills: skills, companyName: "Acme" });
    const second = await syncAgentSkillFolder({ agent: AGENT, companySkills: skills, companyName: "Acme" });
    expect(second.changed).toBe(false);
  });

  it("removes a copy once the skill is turned off", async () => {
    await syncAgentSkillFolder({ agent: AGENT, companySkills: skills });
    const narrowed = {
      ...AGENT,
      adapterConfig: { toderoSkillSync: { desiredSkills: [`company/${COMPANY_ID}/plan`] } },
    };
    const result = await syncAgentSkillFolder({ agent: narrowed, companySkills: skills });
    expect(result.changed).toBe(true);
    expect(result.skillFiles).toEqual(["plan.md"]);
    await expect(fs.stat(path.join(resolveAgentSkillsDir(COMPANY_ID, AGENT_ID), "tone.md"))).rejects.toThrow();
  });

  it("copies nothing that is not part of the pack", async () => {
    const withCommandLineSkill = [
      ...skills,
      packSkill("todero", "Command-line skill.", {
        key: "nabitllc/todero/todero",
        metadata: { sourceKind: "paperclip_bundled" },
      }),
    ];
    const agent = {
      ...AGENT,
      adapterConfig: { toderoSkillSync: { desiredSkills: [`company/${COMPANY_ID}/plan`, "nabitllc/todero/todero"] } },
    };
    const result = await syncAgentSkillFolder({ agent, companySkills: withCommandLineSkill });
    expect(result.skillFiles).toEqual(["plan.md"]);
  });
});

describe("writeAgentHandIn", () => {
  it("writes a dated copy named for the task", async () => {
    const written = await writeAgentHandIn({
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      taskIdentifier: "ZZW-12",
      taskTitle: "Draft the brief",
      body: "Here is the brief.",
      now: new Date("2026-09-11T10:00:00Z"),
    });
    expect(written).toBe(path.join(resolveAgentDocumentsDir(COMPANY_ID, AGENT_ID), "2026-09-11-zzw-12.md"));
    const body = await fs.readFile(written!, "utf8");
    expect(body).toContain("# Draft the brief");
    expect(body).toContain("Handed in for ZZW-12 on 2026-09-11.");
    expect(body).toContain("Here is the brief.");
  });

  it("falls back to the title when there is no identifier", async () => {
    const written = await writeAgentHandIn({
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      taskTitle: "Draft the brief",
      body: "Body.",
      now: new Date("2026-09-11T10:00:00Z"),
    });
    expect(written).toMatch(/2026-09-11-draft-the-brief\.md$/);
  });

  it("writes one file when the same task is handed in twice the same day", async () => {
    const at = new Date("2026-09-11T10:00:00Z");
    await writeAgentHandIn({ companyId: COMPANY_ID, agentId: AGENT_ID, taskIdentifier: "ZZW-12", body: "First.", now: at });
    await writeAgentHandIn({ companyId: COMPANY_ID, agentId: AGENT_ID, taskIdentifier: "ZZW-12", body: "Second.", now: at });
    const files = await fs.readdir(resolveAgentDocumentsDir(COMPANY_ID, AGENT_ID));
    expect(files).toEqual(["2026-09-11-zzw-12.md"]);
    expect(await fs.readFile(path.join(resolveAgentDocumentsDir(COMPANY_ID, AGENT_ID), files[0]!), "utf8"))
      .toContain("Second.");
  });

  it("writes nothing when there is nothing to hand in", async () => {
    expect(await writeAgentHandIn({ companyId: COMPANY_ID, agentId: AGENT_ID, taskIdentifier: "ZZW-12", body: "   " }))
      .toBeNull();
  });
});

describe("readAgentFolder", () => {
  it("reads as empty before anything is written", async () => {
    expect(await readAgentFolder(COMPANY_ID, AGENT_ID)).toEqual({ brief: null, skills: [], documents: [] });
  });

  it("lists the brief, the skills and the hand-ins newest first", async () => {
    await syncAgentSkillFolder({ agent: AGENT, companySkills: [
      packSkill("plan", "---\nname: plan\n---\n\nHow to plan.\n"),
      packSkill("tone", "---\nname: tone\n---\n\nHow to talk.\n"),
    ] });
    await writeAgentHandIn({ companyId: COMPANY_ID, agentId: AGENT_ID, taskIdentifier: "A-1", body: "One.", now: new Date("2026-09-10T00:00:00Z") });
    await writeAgentHandIn({ companyId: COMPANY_ID, agentId: AGENT_ID, taskIdentifier: "A-2", body: "Two.", now: new Date("2026-09-11T00:00:00Z") });

    const folder = await readAgentFolder(COMPANY_ID, AGENT_ID);
    expect(folder.brief).toContain("# Ada");
    expect(folder.skills).toEqual(["plan.md", "tone.md"]);
    expect(folder.documents).toEqual(["2026-09-11-a-2.md", "2026-09-10-a-1.md"]);
  });
});

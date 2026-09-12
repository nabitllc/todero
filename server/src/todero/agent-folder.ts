/**
 * The agent's own folder, beside the instructions bundle Todero already keeps
 * for it: `{instance}/companies/{companyId}/agents/{agentId}/`.
 *
 * It holds `brief.md` (who the agent is and what it reads first), `skills/`
 * (a copy of everything turned on for it) and `documents/` (what it has handed
 * in). A chat-only local model has no tools and cannot write a file, so Todero
 * writes all three on its behalf.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import type { Agent, CompanySkill } from "@todero/shared";
import { isSkillPackSkill } from "@todero/shared";
import { readToderoSkillSyncPreference } from "@todero/adapter-utils/server-utils";
import { resolveToderoInstanceRoot } from "../home-paths.js";

/** `{instance}/companies/{companyId}/agents/{agentId}` — the instructions bundle's parent. */
export function resolveAgentFolderRoot(companyId: string, agentId: string): string {
  return path.resolve(resolveToderoInstanceRoot(), "companies", companyId, "agents", agentId);
}

export function resolveAgentBriefPath(companyId: string, agentId: string): string {
  return path.join(resolveAgentFolderRoot(companyId, agentId), "brief.md");
}

export function resolveAgentSkillsDir(companyId: string, agentId: string): string {
  return path.join(resolveAgentFolderRoot(companyId, agentId), "skills");
}

export function resolveAgentDocumentsDir(companyId: string, agentId: string): string {
  return path.join(resolveAgentFolderRoot(companyId, agentId), "documents");
}

/**
 * Names Windows will not let any file have, whatever the extension.
 * A task called "NUL" is unlikely and entirely legal, so it is handled rather
 * than left to fail silently on the one platform Todero runs on most.
 */
const RESERVED_FILE_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/** A file name that is safe on every platform Todero runs on. */
export function toAgentFolderFileSlug(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug) return fallback;
  return RESERVED_FILE_NAMES.has(slug) ? `${slug}-file` : slug;
}

export interface AgentBriefInput {
  agentName: string;
  roleTitle?: string | null;
  companyName?: string | null;
  mission?: string | null;
  skillNames: string[];
}

/**
 * The agent's one-paragraph brief and the files it reads. Written for a person
 * opening the folder, so it names the files rather than describing machinery.
 */
export function buildAgentBrief(input: AgentBriefInput): string {
  const who = [input.agentName.trim() || "This agent", input.roleTitle?.trim()].filter(Boolean).join(", ");
  const at = input.companyName?.trim() ? ` at ${input.companyName.trim()}` : "";

  const lines: string[] = [
    `# ${input.agentName.trim() || "Agent"}`,
    "",
    `${who}${at}. Everything it works on comes from its tasks in Todero, and everything it hands in comes back here.`,
    "",
  ];

  if (input.mission?.trim()) {
    lines.push("## What the organization is trying to do", "", input.mission.trim(), "");
  }

  lines.push("## What this agent knows", "");
  if (input.skillNames.length === 0) {
    lines.push("Nothing is turned on for this agent yet. Turn something on from the Skills page.", "");
  } else {
    lines.push("A copy of each of these is in `skills/`:", "");
    for (const name of input.skillNames) lines.push(`- ${name}`);
    lines.push("");
  }

  lines.push(
    "## What this agent has produced",
    "",
    "Each hand-in is copied into `documents/`, dated and named for its task.",
    "",
  );

  return lines.join("\n");
}

async function writeIfChanged(filePath: string, content: string): Promise<boolean> {
  const existing = await fs.readFile(filePath, "utf8").catch(() => null);
  if (existing === content) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return true;
}

export interface SyncAgentSkillFolderResult {
  /** Absolute path to the folder. */
  root: string;
  /** Skill file names now in `skills/`, in the order the brief lists them. */
  skillFiles: string[];
  /** True when anything on disk actually changed. */
  changed: boolean;
}

/**
 * Write (or refresh) `brief.md` and `skills/` for one agent.
 *
 * Idempotent: a second call with the same inputs writes nothing and reports
 * `changed: false`. Skill copies that are no longer turned on are removed, so
 * the folder always matches what the agent actually reads.
 */
export async function syncAgentSkillFolder(input: {
  agent: Pick<Agent, "id" | "companyId" | "name" | "title" | "adapterConfig">;
  companySkills: CompanySkill[];
  companyName?: string | null;
  mission?: string | null;
}): Promise<SyncAgentSkillFolderResult> {
  const { agent } = input;
  const root = resolveAgentFolderRoot(agent.companyId, agent.id);
  const skillsDir = resolveAgentSkillsDir(agent.companyId, agent.id);

  const config = typeof agent.adapterConfig === "object" && agent.adapterConfig !== null && !Array.isArray(agent.adapterConfig)
    ? (agent.adapterConfig as Record<string, unknown>)
    : {};
  const turnedOn = new Set(readToderoSkillSyncPreference(config).desiredSkills);
  const packSkills = input.companySkills
    .filter((skill) => turnedOn.has(skill.key) && isSkillPackSkill(skill.metadata))
    .sort((left, right) => left.name.localeCompare(right.name));

  await fs.mkdir(skillsDir, { recursive: true });
  await fs.mkdir(resolveAgentDocumentsDir(agent.companyId, agent.id), { recursive: true });

  let changed = false;
  const skillFiles: string[] = [];
  for (const skill of packSkills) {
    const fileName = `${toAgentFolderFileSlug(skill.slug || skill.name, "skill")}.md`;
    skillFiles.push(fileName);
    if (await writeIfChanged(path.join(skillsDir, fileName), skill.markdown)) changed = true;
  }

  const keep = new Set(skillFiles);
  for (const entry of await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || keep.has(entry.name)) continue;
    await fs.rm(path.join(skillsDir, entry.name), { force: true });
    changed = true;
  }

  const brief = buildAgentBrief({
    agentName: agent.name,
    roleTitle: agent.title ?? null,
    companyName: input.companyName ?? null,
    mission: input.mission ?? null,
    skillNames: packSkills.map((skill) => skill.name),
  });
  if (await writeIfChanged(resolveAgentBriefPath(agent.companyId, agent.id), brief)) changed = true;

  return { root, skillFiles, changed };
}

/**
 * Keep a dated copy of a hand-in beside the agent's own files.
 *
 * The name carries the date and the task, so a folder read in order reads as
 * the agent's work history. Handing the same task in twice on the same day
 * replaces that day's copy rather than piling up near-duplicates.
 */
export async function writeAgentHandIn(input: {
  companyId: string;
  agentId: string;
  taskIdentifier?: string | null;
  taskTitle?: string | null;
  body: string;
  now?: Date;
}): Promise<string | null> {
  const body = input.body.trim();
  if (!body) return null;

  const now = input.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const label = toAgentFolderFileSlug(
    input.taskIdentifier?.trim() || input.taskTitle?.trim() || "",
    "hand-in",
  );
  const documentsDir = resolveAgentDocumentsDir(input.companyId, input.agentId);
  const filePath = path.join(documentsDir, `${date}-${label}.md`);

  const heading = input.taskTitle?.trim()
    ? `# ${input.taskTitle.trim()}`
    : `# ${input.taskIdentifier?.trim() || "Hand-in"}`;
  const attribution = input.taskIdentifier?.trim()
    ? `Handed in for ${input.taskIdentifier.trim()} on ${date}.`
    : `Handed in on ${date}.`;

  await fs.mkdir(documentsDir, { recursive: true });
  await fs.writeFile(filePath, `${heading}\n\n${attribution}\n\n${body}\n`, "utf8");
  return filePath;
}

export interface AgentFolderContents {
  /** The brief, or null when the folder has not been written yet. */
  brief: string | null;
  /** File names in `skills/`, sorted. */
  skills: string[];
  /** File names in `documents/`, newest name first. */
  documents: string[];
}

/**
 * What is in the agent's folder right now. A folder that does not exist yet
 * reads as empty rather than as an error: nothing about a new agent is wrong.
 */
export async function readAgentFolder(companyId: string, agentId: string): Promise<AgentFolderContents> {
  const brief = await fs.readFile(resolveAgentBriefPath(companyId, agentId), "utf8").catch(() => null);

  const listMarkdown = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  };

  const skills = (await listMarkdown(resolveAgentSkillsDir(companyId, agentId))).sort();
  const documents = (await listMarkdown(resolveAgentDocumentsDir(companyId, agentId)))
    .sort()
    .reverse();

  return { brief, skills, documents };
}

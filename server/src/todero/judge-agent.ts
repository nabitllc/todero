/**
 * The reviewer is a teammate, not a hidden second call. It gets an agent
 * record of its own — same adapter, same local model, its own name — so its
 * comments carry an author the person recognises and so it shows up on the
 * team like everyone else.
 *
 * It is hired once, when the first plan of a company is approved, and found
 * again by a marker in the agent's `metadata` (no new column).
 */
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@todero/db";
import { agents } from "@todero/db";

export const JUDGE_AGENT_METADATA_KEY = "toderoJudge";
export const JUDGE_AGENT_METADATA_VERSION = 1;

export type JudgeAgentRow = {
  id: string;
  name: string;
  companyId: string;
  status: string;
  adapterType: string;
  adapterConfig: unknown;
};

export function buildJudgeAgentName(leadName: string): string {
  const name = leadName.trim() || "the agent";
  return /s$/i.test(name) ? `${name}' reviewer` : `${name}'s reviewer`;
}

export function buildJudgeAgentMetadata(leadAgentId: string): Record<string, unknown> {
  return {
    [JUDGE_AGENT_METADATA_KEY]: { version: JUDGE_AGENT_METADATA_VERSION, forAgentId: leadAgentId },
  };
}

/** True when this agent record is the reviewer hired for `leadAgentId`. */
export function isJudgeAgentMetadataFor(metadata: unknown, leadAgentId: string): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const marker = (metadata as Record<string, unknown>)[JUDGE_AGENT_METADATA_KEY];
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return false;
  return (marker as Record<string, unknown>).forAgentId === leadAgentId;
}

/**
 * The marker is matched in the database, not in memory: this runs on every
 * hand-in, and a company can have a long roster. The in-memory check stays as
 * the second half of the test so the shape of the marker is only defined once.
 */
export async function findJudgeAgentForLead(
  db: Db,
  input: { companyId: string; leadAgentId: string },
): Promise<JudgeAgentRow | null> {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      companyId: agents.companyId,
      status: agents.status,
      adapterType: agents.adapterType,
      adapterConfig: agents.adapterConfig,
      metadata: agents.metadata,
    })
    .from(agents)
    .where(
      and(
        eq(agents.companyId, input.companyId),
        ne(agents.status, "terminated"),
        sql`${agents.metadata} -> ${JUDGE_AGENT_METADATA_KEY} ->> 'forAgentId' = ${input.leadAgentId}`,
      ),
    )
    .limit(1);
  const match = rows.find((row) => isJudgeAgentMetadataFor(row.metadata, input.leadAgentId));
  if (!match) return null;
  const { metadata: _metadata, ...agent } = match;
  return agent;
}

export type JudgeAgentInsert = Omit<typeof agents.$inferInsert, "companyId">;

export type JudgeAgentHireDeps = {
  create: (
    companyId: string,
    data: JudgeAgentInsert,
  ) => Promise<{ id: string; name: string; companyId: string; status: string; adapterType: string; adapterConfig: unknown }>;
};

/**
 * Hire the reviewer for a lead agent if it does not exist yet. Same adapter
 * config as the lead: one local model on this machine serves both. The
 * reviewer has no heartbeat timer of its own — it only ever speaks when a
 * task is handed in.
 */
export async function ensureJudgeAgentForLead(
  db: Db,
  agentsSvc: JudgeAgentHireDeps,
  lead: { id: string; companyId: string; name: string; adapterType: string; adapterConfig: unknown },
): Promise<JudgeAgentRow | null> {
  const existing = await findJudgeAgentForLead(db, { companyId: lead.companyId, leadAgentId: lead.id });
  if (existing) return existing;
  const created = await agentsSvc.create(lead.companyId, {
    name: buildJudgeAgentName(lead.name),
    role: "general",
    title: "Reviewer",
    status: "idle",
    adapterType: lead.adapterType,
    adapterConfig:
      lead.adapterConfig && typeof lead.adapterConfig === "object" && !Array.isArray(lead.adapterConfig)
        ? { ...(lead.adapterConfig as Record<string, unknown>) }
        : {},
    capabilities: "Reviews finished work against what the task asked for.",
    runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
    metadata: buildJudgeAgentMetadata(lead.id),
  });
  return {
    id: created.id,
    name: created.name,
    companyId: created.companyId,
    status: created.status,
    adapterType: created.adapterType,
    adapterConfig: created.adapterConfig,
  };
}

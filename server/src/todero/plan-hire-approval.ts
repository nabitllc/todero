/**
 * Approving a plan can add teammates: the reviewer, and sometimes a second
 * worker. When the organization asks for a person's approval before a new
 * teammate starts, those additions take the same path a person's own hire
 * takes — the agent record is created in `pending_approval` and paired with a
 * `hire_agent` approval the person answers in the Inbox — instead of quietly
 * starting work nobody signed off on.
 */
import { companies, type Db } from "@todero/db";
import { eq } from "drizzle-orm";
import { approvalService } from "../services/approvals.js";

export type PendingHireAgent = {
  id: string;
  name: string;
  role?: string | null;
  title?: string | null;
  reportsTo?: string | null;
  capabilities?: string | null;
  adapterType: string;
  adapterConfig?: unknown;
  runtimeConfig?: unknown;
  metadata?: unknown;
};

/** Does this organization want a person to approve a new teammate first? */
export async function readRequireBoardApprovalForNewAgents(
  db: Db,
  companyId: string,
): Promise<boolean> {
  const rows = await db
    .select({ require: companies.requireBoardApprovalForNewAgents })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return rows[0]?.require === true;
}

/**
 * Pair a just-created `pending_approval` agent with the approval a person
 * answers. Mirrors the payload the hire route writes so the Inbox card and the
 * approve action read exactly the same fields.
 */
export async function requestHireApproval(
  db: Db,
  input: {
    companyId: string;
    agent: PendingHireAgent;
    requestedByUserId?: string | null;
    requestedByAgentId?: string | null;
  },
) {
  const approvalsSvc = approvalService(db);
  return approvalsSvc.create(input.companyId, {
    type: "hire_agent",
    requestedByAgentId: input.requestedByAgentId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
    status: "pending",
    payload: {
      name: input.agent.name,
      role: input.agent.role ?? "general",
      title: input.agent.title ?? null,
      reportsTo: input.agent.reportsTo ?? null,
      capabilities: input.agent.capabilities ?? null,
      adapterType: input.agent.adapterType,
      adapterConfig: input.agent.adapterConfig ?? {},
      runtimeConfig: input.agent.runtimeConfig ?? {},
      metadata: input.agent.metadata ?? {},
      agentId: input.agent.id,
    },
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    updatedAt: new Date(),
  });
}

/**
 * The one short line the task gets when a plan's teammates need a person's
 * yes. Plain words only: a person reads this on the task, not in a log.
 */
export function buildPendingHireComment(names: string[]): string {
  const waiting = names.filter((name) => name.trim());
  if (waiting.length === 0) return "";
  if (waiting.length === 1) {
    return `${waiting[0]} waits for your approval in the Inbox before starting.`;
  }
  const last = waiting[waiting.length - 1]!;
  const rest = waiting.slice(0, -1).join(", ");
  return `${rest} and ${last} wait for your approval in the Inbox before starting.`;
}

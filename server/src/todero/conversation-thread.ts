import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@todero/db";
import { companies, goals, issueComments, issues } from "@todero/db";
import { isChatCompletionsUrl } from "../adapters/http/chat-completions.js";

/**
 * A local LLM hired through the wizard talks to an OpenAI-style
 * `/v1/chat/completions` URL through the http adapter. Such an agent has no
 * tools: the ticket thread is the whole conversation, so the heartbeat feeds
 * it back in and reads a status line out of the reply instead of expecting
 * API calls.
 */
export function isConversationalHttpAgent(agent: {
  adapterType: string;
  adapterConfig: unknown;
}): boolean {
  if (agent.adapterType !== "http") return false;
  const config = agent.adapterConfig;
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const url = (config as Record<string, unknown>).url;
  return typeof url === "string" && isChatCompletionsUrl(url);
}

export type ConversationTurn = { role: "agent" | "user"; body: string };

export const CONVERSATION_THREAD_MAX_TURNS = 20;
export const CONVERSATION_THREAD_MAX_TURN_CHARS = 4_000;

function clipTurn(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > CONVERSATION_THREAD_MAX_TURN_CHARS
    ? `${trimmed.slice(0, CONVERSATION_THREAD_MAX_TURN_CHARS - 1)}…`
    : trimmed;
}

/**
 * Whose turn a comment is, from the point of view of the agent about to read
 * the thread. Its own comments are its own turns; everything else — the
 * person, and any other agent such as the reviewer — is a turn it must answer.
 * Without the reader, any agent comment counts as its own, which is what the
 * single-agent case has always done.
 */
export function conversationTurnRole(
  comment: {
    authorType: string | null;
    authorAgentId: string | null;
    derivedAuthorAgentId: string | null;
  },
  readerAgentId?: string | null,
): "agent" | "user" {
  const authorAgentId = comment.authorAgentId || comment.derivedAuthorAgentId || null;
  const fromAnAgent = comment.authorType === "agent" || Boolean(authorAgentId);
  if (!fromAnAgent) return "user";
  if (!readerAgentId) return "agent";
  return authorAgentId === readerAgentId ? "agent" : "user";
}

/**
 * Oldest-first turns of the human/agent conversation on an issue. System
 * notices (comments with a presentation block) are Todero talking to itself
 * about recovery and never belong in the model's context.
 */
export async function loadConversationThread(
  db: Db,
  input: { companyId: string; issueId: string; limit?: number; readerAgentId?: string | null },
): Promise<ConversationTurn[]> {
  const limit = input.limit ?? CONVERSATION_THREAD_MAX_TURNS;
  const rows = await db
    .select({
      body: issueComments.body,
      authorType: issueComments.authorType,
      authorAgentId: issueComments.authorAgentId,
      derivedAuthorAgentId: issueComments.derivedAuthorAgentId,
      presentation: issueComments.presentation,
    })
    .from(issueComments)
    .where(
      and(
        eq(issueComments.companyId, input.companyId),
        eq(issueComments.issueId, input.issueId),
        isNull(issueComments.deletedAt),
      ),
    )
    .orderBy(desc(issueComments.createdAt), desc(issueComments.id))
    .limit(limit * 2);

  const turns: ConversationTurn[] = [];
  for (const row of rows) {
    if (row.presentation) continue;
    const body = clipTurn(row.body ?? "");
    if (!body) continue;
    turns.push({ role: conversationTurnRole(row, input.readerAgentId), body });
    if (turns.length >= limit) break;
  }
  return turns.reverse();
}

export const WAITING_ON_YOU_MARKER = "<!-- todero-blocked-by: waiting-on-you -->";
const WAITING_ON_YOU_RE = /<!--\s*todero-blocked-by:\s*waiting-on-you\s*-->\s*\n?/gi;
const TYPE_MARKER_RE = /^(\s*<!--\s*todero-type:\s*[A-Za-z]+\s*-->\s*\n?)/;

/**
 * The work-item view shows "Blocked · Waiting on you." when the description
 * carries this marker and the issue is blocked. Keep it right under the type
 * marker, where the UI's own serializer puts it.
 */
export function descriptionWithWaitingMarker(description: string | null | undefined, waiting: boolean): string {
  const stripped = (description ?? "").replace(WAITING_ON_YOU_RE, "");
  if (!waiting) return stripped;
  const typeMatch = stripped.match(TYPE_MARKER_RE);
  if (typeMatch) {
    const head = typeMatch[1]!.replace(/\s*$/, "\n");
    return `${head}${WAITING_ON_YOU_MARKER}\n${stripped.slice(typeMatch[1]!.length).replace(/^\s*\n/, "")}`;
  }
  return `${WAITING_ON_YOU_MARKER}\n${stripped.replace(/^\s*\n/, "")}`;
}

export type ConversationDisposition = "done" | "waiting";

export function readConversationDisposition(resultJson: unknown): ConversationDisposition | null {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) return null;
  const value = (resultJson as Record<string, unknown>).toderoDisposition;
  return value === "done" || value === "waiting" ? value : null;
}

/**
 * What the issue should look like after a conversational reply. `done`
 * closes it; `waiting` hands the turn to the person as a blocked issue with
 * the waiting-on-you marker, which is the state the work-item view renders as
 * "Blocked · Waiting on you." and the state a later comment can wake from.
 * Returns null when the issue is not in a state the agent owns.
 */
export function planConversationDisposition(input: {
  issue: { status: string; description: string | null };
  disposition: ConversationDisposition;
}): { status: "done" | "blocked"; description: string } | null {
  if (input.issue.status !== "in_progress") return null;
  if (input.disposition === "done") {
    return { status: "done", description: descriptionWithWaitingMarker(input.issue.description, false) };
  }
  return { status: "blocked", description: descriptionWithWaitingMarker(input.issue.description, true) };
}

export type ConversationIdentity = {
  agentName: string;
  roleTitle: string | null;
  companyName: string | null;
  mission: string | null;
};

/**
 * What a chat-only agent should know about itself before it reads the task.
 * The http adapter never reads the materialized AGENTS.md, so this is the
 * agent's standing brief: name, title, company, and the company mission from
 * the goal the issue hangs off (or the company's root goal when the issue has
 * none). Every field is optional except the name; the prompt degrades to a
 * plain introduction when a company has no goal yet.
 */
export async function loadConversationIdentity(
  db: Db,
  input: {
    agent: { name: string; title?: string | null; role?: string | null; companyId: string };
    issueId: string | null;
  },
): Promise<ConversationIdentity> {
  const [companyRow] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, input.agent.companyId))
    .limit(1);

  let goalRow: { title: string; description: string | null } | null = null;
  if (input.issueId) {
    const [issueRow] = await db
      .select({ goalId: issues.goalId })
      .from(issues)
      .where(and(eq(issues.companyId, input.agent.companyId), eq(issues.id, input.issueId)))
      .limit(1);
    if (issueRow?.goalId) {
      const [row] = await db
        .select({ title: goals.title, description: goals.description })
        .from(goals)
        .where(and(eq(goals.companyId, input.agent.companyId), eq(goals.id, issueRow.goalId)))
        .limit(1);
      goalRow = row ?? null;
    }
  }
  if (!goalRow) {
    const [row] = await db
      .select({ title: goals.title, description: goals.description })
      .from(goals)
      .where(and(eq(goals.companyId, input.agent.companyId), eq(goals.level, "company"), isNull(goals.parentId)))
      .orderBy(asc(goals.createdAt), asc(goals.id))
      .limit(1);
    goalRow = row ?? null;
  }

  const mission = goalRow ? (goalRow.description?.trim() || goalRow.title.trim() || null) : null;
  const roleTitle = input.agent.title?.trim() || null;
  return {
    agentName: input.agent.name.trim(),
    roleTitle,
    companyName: companyRow?.name?.trim() || null,
    mission,
  };
}

/** The issue document the proposed plan lives in; the product already treats `plan` as the plan. */
export const CONVERSATION_PLAN_DOCUMENT_KEY = "plan";

/**
 * The Plan document body: a heading for people plus the canonical block the
 * approve endpoint and the work-item view both parse. Keeping the block verbatim
 * means one parser everywhere and no second store for the structured plan.
 */
export function buildConversationPlanDocumentBody(planBlock: string): string {
  return `# Plan\n\nProposed by the agent in the task thread. Approve it on the task, or ask for changes there.\n\n${planBlock.trim()}\n`;
}

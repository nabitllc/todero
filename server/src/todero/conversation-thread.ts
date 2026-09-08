import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@todero/db";
import { issueComments } from "@todero/db";
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
 * Oldest-first turns of the human/agent conversation on an issue. System
 * notices (comments with a presentation block) are Todero talking to itself
 * about recovery and never belong in the model's context.
 */
export async function loadConversationThread(
  db: Db,
  input: { companyId: string; issueId: string; limit?: number },
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
    const isAgent =
      row.authorType === "agent" || Boolean(row.authorAgentId || row.derivedAuthorAgentId);
    turns.push({ role: isAgent ? "agent" : "user", body });
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

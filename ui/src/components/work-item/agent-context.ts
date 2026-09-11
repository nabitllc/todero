/**
 * What the agent saw on its last turn, read back out of what was stored at the
 * time. Never rebuilt: a fresh call would show today's brief and today's skills
 * against yesterday's reply, which is exactly the question this panel answers.
 *
 * The stored shape is a loose bag, so everything here is defensive: a turn
 * recorded before a field existed is a missing field, not an error.
 */

export type AgentContextMessage = { role: "agent" | "person"; body: string };

export type AgentContext = {
  agentName: string | null;
  roleTitle: string | null;
  companyName: string | null;
  mission: string | null;
  brief: string | null;
  standingInstructions: string | null;
  turnInstruction: string | null;
  thread: AgentContextMessage[];
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function thread(value: unknown): AgentContextMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: AgentContextMessage[] = [];
  for (const entry of value) {
    const row = object(entry);
    if (!row) continue;
    const body = text(row.body) ?? text(row.content);
    if (!body) continue;
    // Everything that is not the agent's own turn is the person's side of it.
    messages.push({ role: row.role === "agent" || row.role === "assistant" ? "agent" : "person", body });
  }
  return messages;
}

/** Null when the turn stored nothing worth showing. */
export function readAgentContext(snapshot: unknown): AgentContext | null {
  const row = object(snapshot);
  if (!row) return null;
  const identity = object(row.toderoIdentity) ?? {};
  const context: AgentContext = {
    agentName: text(identity.agentName),
    roleTitle: text(identity.roleTitle),
    companyName: text(identity.companyName),
    mission: text(identity.mission),
    brief: text(row.toderoTaskMarkdown),
    standingInstructions: text(row.toderoSkillText),
    turnInstruction: text(row.toderoTurnInstruction),
    thread: thread(row.toderoThread),
  };
  const empty =
    !context.brief &&
    !context.standingInstructions &&
    !context.turnInstruction &&
    context.thread.length === 0 &&
    !context.agentName &&
    !context.mission;
  return empty ? null : context;
}

/** "What Nova sees", or "What the agent sees" when the screen has no name. */
export function whatAgentSeesTitle(agentName: string | null | undefined): string {
  const name = agentName?.trim();
  return name ? `What ${name} sees` : "What the agent sees";
}

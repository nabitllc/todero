import { asString, parseObject } from "../utils.js";
import { pickModelForKind, type ModelRoutingTaskKind } from "../../todero/model-routing.js";

export type ChatCompletionsMessage = {
  role: string;
  content: string;
};

export type ChatCompletionsThreadTurn = {
  role: "agent" | "user";
  body: string;
};

/** What a plain chat model can hand back about the task after replying. */
export type ChatCompletionsDisposition = "done" | "waiting";

export const CHAT_COMPLETIONS_STATUS_DONE = "STATUS: done";
export const CHAT_COMPLETIONS_STATUS_WAITING = "STATUS: waiting";

const STATUS_LINE_RE = /^\s*\**\s*status\s*:\s*\**\s*(done|waiting|finished|complete|completed|blocked|working|continue)\s*\**\s*\.?\s*$/i;
const STATUS_SUFFIX_RE = /\s+\**\s*status\s*:\s*\**\s*(done|waiting|finished|complete|completed|blocked|working|continue)\s*\**\s*\.?\s*$/i;

/**
 * Local LLM hire points the http adapter at `/v1/chat/completions`.
 * That endpoint reads `messages`, not the managed AGENTS.md bundle (http
 * skips materializing it) and not a raw `{ context }` dump.
 */
export function isChatCompletionsUrl(url: string): boolean {
  try {
    return /\/v1\/chat\/completions\/?$/i.test(new URL(url).pathname);
  } catch {
    return /\/v1\/chat\/completions\/?$/i.test(url);
  }
}

function readNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readMessageContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string") parts.push(record.text);
    else if (typeof record.content === "string") parts.push(record.content);
  }
  return parts.join("").trim();
}

/**
 * Assistant text from an OpenAI-compatible `/v1/chat/completions` body.
 * Empty / whitespace / missing choices is empty string — not a reply.
 */
export function parseChatCompletionsText(body: unknown): string {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return "";
    try {
      return parseChatCompletionsText(JSON.parse(trimmed) as unknown);
    } catch {
      return "";
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";

  const record = body as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const texts: string[] = [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const row = choice as Record<string, unknown>;
    const message =
      row.message && typeof row.message === "object" && !Array.isArray(row.message)
        ? (row.message as Record<string, unknown>)
        : null;
    const text = readMessageContent(message?.content) || readMessageContent(row.text);
    if (text) texts.push(text);
  }
  return texts.join("\n").trim();
}

/**
 * A chat model has no Todero tools, so the only way it can say "I am
 * finished" is a trailing status line. The line is stripped from what the
 * user sees. No line at all means the model is waiting on the user — in a
 * conversation that is the normal case, and the safe one.
 */
export function parseChatCompletionsReply(text: string): {
  body: string;
  disposition: ChatCompletionsDisposition;
} {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let disposition: ChatCompletionsDisposition = "waiting";
  const readWord = (word: string) => {
    const lower = word.toLowerCase();
    if (lower === "done" || lower === "finished" || lower === "complete" || lower === "completed") {
      disposition = "done";
    }
  };
  while (lines.length > 0) {
    const last = lines[lines.length - 1]!;
    if (!last.trim()) {
      lines.pop();
      continue;
    }
    const match = last.match(STATUS_LINE_RE);
    if (match) {
      readWord(match[1]!);
      lines.pop();
      continue;
    }
    // Small models sometimes tack the status onto the end of the last
    // sentence ("Please choose one. STATUS: waiting"). Strip that suffix too.
    const suffix = last.match(STATUS_SUFFIX_RE);
    if (suffix) {
      readWord(suffix[1]!);
      lines[lines.length - 1] = last.slice(0, suffix.index).trimEnd();
    }
    break;
  }
  return { body: lines.join("\n").trim(), disposition };
}

/**
 * The prompt the heartbeat actually sends: `toderoTaskMarkdown` is the
 * run-context brief (first-task description + title). Issue fields are a
 * fallback when the compact/full markdown was stripped.
 */
export function buildChatCompletionsPrompt(context: Record<string, unknown>): string {
  const taskMarkdown = readNonEmptyString(context.toderoTaskMarkdown);
  if (taskMarkdown) return stripToderoMarkers(taskMarkdown);

  const issue = parseObject(context.toderoIssue);
  const title = readNonEmptyString(issue.title);
  const description = readNonEmptyString(issue.description);
  return stripToderoMarkers([title, description].filter(Boolean).join("\n\n"));
}

/**
 * Todero writes small HTML comments on a task's description for its own views —
 * the type, the waiting-on-you flag. They mean nothing to a chat model and a
 * small one will try to explain them, so they never reach the prompt.
 */
export function stripToderoMarkers(text: string): string {
  return text.replace(/<!--\s*todero-[a-z-]+:[^>]*-->\s*\n?/gi, "").trim();
}

export type ChatCompletionsIdentity = {
  agentName: string;
  roleTitle?: string | null;
  companyName?: string | null;
  mission?: string | null;
};

export function readChatCompletionsIdentity(
  context: Record<string, unknown>,
  fallbackAgentName: string,
): ChatCompletionsIdentity {
  const raw = parseObject(context.toderoIdentity);
  return {
    agentName: readNonEmptyString(raw.agentName) || fallbackAgentName,
    roleTitle: readNonEmptyString(raw.roleTitle) || null,
    companyName: readNonEmptyString(raw.companyName) || null,
    mission: readNonEmptyString(raw.mission) || null,
  };
}

/**
 * The standing brief for a chat-only agent. The http adapter never reads the
 * materialized AGENTS.md, so this is where the agent learns who it is and what
 * the company is for. Kept short on purpose: a 7B model loses the thread past
 * a few hundred words of preamble.
 */
export function buildChatCompletionsSystemPrompt(identity: ChatCompletionsIdentity | string): string {
  const id: ChatCompletionsIdentity =
    typeof identity === "string" ? { agentName: identity } : identity;
  const name = id.agentName.trim() || "the assistant";
  const role = id.roleTitle?.trim();
  const company = id.companyName?.trim();
  const mission = id.mission?.replace(/\s+/g, " ").trim();
  const who = [
    `You are ${name}`,
    role ? `, ${role}` : "",
    company ? ` at ${company}` : "",
    ", an AI teammate working inside Todero. You are talking with the person who hired you, in the thread of one task.",
  ].join("");
  return [
    who,
    ...(mission ? [`The company mission: ${mission}`] : []),
    "You have no tools and cannot call any API, create tasks, or hire anyone. Do the work in plain text: answer, ask, propose, or draft. Never claim to have taken an action you could not take.",
    "Write for that person: short, direct, no narration of your own process. Use plain prose or a short list. If you need something from them, ask one clear question and stop.",
    "The first message is the task. Later messages are the conversation so far. Continue it naturally; do not re-introduce yourself or repeat what was already said.",
    `End every reply with exactly one line: \`${CHAT_COMPLETIONS_STATUS_DONE}\` if the task is finished and nothing more is expected from you, or \`${CHAT_COMPLETIONS_STATUS_WAITING}\` if you need the person to answer, approve, or decide before you can go on.`,
  ].join("\n\n");
}

export function readChatCompletionsThread(context: Record<string, unknown>): ChatCompletionsThreadTurn[] {
  const raw = Array.isArray(context.toderoThread) ? context.toderoThread : [];
  const turns: ChatCompletionsThreadTurn[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const body = readNonEmptyString(record.body);
    if (!body) continue;
    const role = record.role === "agent" ? "agent" : record.role === "user" ? "user" : null;
    if (!role) continue;
    turns.push({ role, body });
  }
  return turns;
}

/**
 * Sent when the thread ends with the agent's own words (a re-opened task, a
 * status nudge). A chat model given a transcript that ends in its own turn
 * returns an empty completion; it needs a user turn to answer.
 */
export const CHAT_COMPLETIONS_EMPTY_REPLY_NUDGE =
  "That reply had only a status line and no content. Write the reply itself now: the output the task asks for, or the one question you need answered. Then end with the status line.";

export const CHAT_COMPLETIONS_NO_TEXT_FALLBACK =
  "The model sent back no text with its status this time.";

export const CHAT_COMPLETIONS_CONTINUE_NUDGE =
  "(No reply from the person yet. Pick up where you left off in one short message, or restate the one question you most need answered.)";

export function buildChatCompletionsMessages(
  context: Record<string, unknown>,
  options: { agentName?: string } = {},
): ChatCompletionsMessage[] {
  const messages: ChatCompletionsMessage[] = [
    {
      role: "system",
      content: buildChatCompletionsSystemPrompt(
        readChatCompletionsIdentity(context, options.agentName ?? ""),
      ),
    },
    { role: "user", content: buildChatCompletionsPrompt(context) },
  ];
  // Consecutive turns from the same side collapse into one message: chat
  // templates expect strict alternation and some models go silent otherwise.
  for (const turn of readChatCompletionsThread(context)) {
    const role = turn.role === "agent" ? "assistant" : "user";
    const last = messages[messages.length - 1]!;
    if (last.role === role && messages.length > 2) {
      last.content = `${last.content}\n\n${turn.body}`;
      continue;
    }
    messages.push({ role, content: turn.body });
  }
  // A turn instruction from Todero itself (for example: every task in the
  // plan is closed, write the wrap-up) is the last thing the model reads.
  const turnInstruction = readNonEmptyString(context.toderoTurnInstruction);
  if (turnInstruction) {
    const last = messages[messages.length - 1]!;
    if (last.role === "user" && messages.length > 2) last.content = `${last.content}\n\n${turnInstruction}`;
    else messages.push({ role: "user", content: turnInstruction });
    return messages;
  }
  if (messages[messages.length - 1]!.role === "assistant") {
    messages.push({ role: "user", content: CHAT_COMPLETIONS_CONTINUE_NUDGE });
  }
  return messages;
}

const MODEL_ROUTING_TASK_KINDS: ModelRoutingTaskKind[] = [
  "planning",
  "judging",
  "drafting",
  "wrap-up",
  "formatting",
];

/**
 * `context.toderoTaskKind`, set by the heartbeat before invoking the
 * adapter. Unrecognized or missing values mean "no routing preference" —
 * the caller keeps the model it already resolved from config.
 */
function readTaskKind(context: Record<string, unknown>): ModelRoutingTaskKind | null {
  const raw = readNonEmptyString(context.toderoTaskKind);
  return (MODEL_ROUTING_TASK_KINDS as string[]).includes(raw) ? (raw as ModelRoutingTaskKind) : null;
}

/**
 * `context.toderoAvailableModels`, the flat list of model ids the local-llm
 * detect endpoint reported for the runtime in use. Not always populated —
 * `pickModelForKind` falls back to the default model when it is empty.
 */
function readAvailableModels(context: Record<string, unknown>): string[] {
  const raw = context.toderoAvailableModels;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export function buildChatCompletionsBody(input: {
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  payloadTemplate: Record<string, unknown>;
  agentName?: string;
}): Record<string, unknown> {
  const configuredModel =
    asString(input.config.model, "") || asString(input.payloadTemplate.model, "");
  const kind = readTaskKind(input.context);
  // Routing only has an opinion when the heartbeat named a task kind; with
  // no kind (a non-conversational http agent, or a call site that predates
  // this) the previously configured model is used unchanged.
  const model = kind
    ? pickModelForKind({ kind, available: readAvailableModels(input.context), defaultModel: configuredModel })
    : configuredModel;
  return {
    ...input.payloadTemplate,
    ...(model ? { model } : {}),
    messages: buildChatCompletionsMessages(input.context, { agentName: input.agentName }),
  };
}

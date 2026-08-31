import { asString, parseObject } from "../utils.js";

export type ChatCompletionsMessage = {
  role: string;
  content: string;
};

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
 * The prompt the heartbeat actually sends: `toderoTaskMarkdown` is the
 * run-context brief (first-task description + title). Issue fields are a
 * fallback when the compact/full markdown was stripped.
 */
export function buildChatCompletionsPrompt(context: Record<string, unknown>): string {
  const taskMarkdown = readNonEmptyString(context.toderoTaskMarkdown);
  if (taskMarkdown) return taskMarkdown;

  const issue = parseObject(context.toderoIssue);
  const title = readNonEmptyString(issue.title);
  const description = readNonEmptyString(issue.description);
  return [title, description].filter(Boolean).join("\n\n");
}

export function buildChatCompletionsMessages(
  context: Record<string, unknown>,
): ChatCompletionsMessage[] {
  return [
    {
      role: "user",
      content: buildChatCompletionsPrompt(context),
    },
  ];
}

export function buildChatCompletionsBody(input: {
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  payloadTemplate: Record<string, unknown>;
}): Record<string, unknown> {
  const model =
    asString(input.config.model, "") || asString(input.payloadTemplate.model, "");
  return {
    ...input.payloadTemplate,
    ...(model ? { model } : {}),
    messages: buildChatCompletionsMessages(input.context),
  };
}

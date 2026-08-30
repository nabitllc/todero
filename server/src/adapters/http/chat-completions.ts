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

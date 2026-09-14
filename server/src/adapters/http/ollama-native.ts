/**
 * Ollama's own chat endpoint, used when Todero knows the window it wants.
 *
 * Ollama serves two chat endpoints. The OpenAI-shaped one at
 * `/v1/chat/completions` is what the hire configures, and it silently ignores
 * `options` — measured against Ollama 0.34.0, a request carrying
 * `options.num_ctx: 16384` still loaded the model at 4,096 tokens. Its own
 * endpoint at `/api/chat` honours the same field: the model loaded at 16,384.
 *
 * So when a connection test recorded a window for this organization, the
 * request goes to `/api/chat` and asks for it. With no recorded window nothing
 * changes: the request stays OpenAI-shaped and the runtime keeps deciding.
 * Everything here is a pure translation between the two shapes.
 */
export function ollamaNativeChatUrl(url: string): string | null {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) return null;
  const match = trimmed.replace(/\/+$/, "").match(/^(.*)\/v1\/chat\/completions$/i);
  return match ? `${match[1]}/api/chat` : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The same conversation, in the shape `/api/chat` reads, with the window set. */
export function buildOllamaNativeBody(input: {
  body: Record<string, unknown>;
  contextLength: number;
}): Record<string, unknown> {
  const { model, messages, temperature, max_tokens: maxTokens, options, ...rest } = input.body;
  const nativeOptions: Record<string, unknown> = { ...asRecord(options) };
  if (typeof temperature === "number") nativeOptions.temperature = temperature;
  if (typeof maxTokens === "number") nativeOptions.num_predict = maxTokens;
  nativeOptions.num_ctx = input.contextLength;
  // Anything else the payload template carried is left where it was: the
  // native endpoint ignores what it does not know, the same as the other one.
  const passthrough = { ...rest };
  delete passthrough.stream;
  return {
    ...passthrough,
    ...(model ? { model } : {}),
    messages: Array.isArray(messages) ? messages : [],
    stream: false,
    options: nativeOptions,
  };
}

function parseNativeBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return null;
    try {
      return parseNativeBody(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** The assistant text from a non-streamed `/api/chat` reply. */
export function parseOllamaNativeText(body: unknown): string {
  const record = parseNativeBody(body);
  if (!record) return "";
  const message = asRecord(record.message);
  const content = message.content;
  return typeof content === "string" ? content.trim() : "";
}

/**
 * Why the model stopped. `/api/chat` says `done_reason`, where the
 * OpenAI-shaped endpoint says `finish_reason`; "length" means the same thing
 * in both, so the cut-off note keeps working.
 */
export function parseOllamaNativeFinishReason(body: unknown): string | null {
  const record = parseNativeBody(body);
  const reason = record?.done_reason;
  return typeof reason === "string" && reason.trim() ? reason.trim().toLowerCase() : null;
}

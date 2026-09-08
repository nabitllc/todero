/**
 * Prove a detected local LLM can actually answer before the wizard lets the
 * customer hire on it. Detection only shows that a server lists a model;
 * this sends one short chat completion and waits for the reply, which is
 * what the first task will do.
 *
 * Loopback only: the wizard's picker only ever offers localhost runtimes, and
 * an open POST-to-any-URL endpoint would be a server-side request forgery
 * hole in an otherwise local-first product.
 */
export type LocalLlmTestInput = {
  baseUrl: string;
  modelId: string;
};

export type LocalLlmTestResult =
  | { ok: true; reply: string; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

// A cold model can take a while to load into memory on the first request.
export const LOCAL_LLM_TEST_TIMEOUT_MS = 120_000;
export const LOCAL_LLM_TEST_PROMPT = "Reply with the single word OK.";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "0.0.0.0"]);

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function readReplyText(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return "";
  const parts: string[] = [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const message = (choice as Record<string, unknown>).message;
    const content =
      message && typeof message === "object" && !Array.isArray(message)
        ? (message as Record<string, unknown>).content
        : null;
    if (typeof content === "string" && content.trim()) parts.push(content.trim());
  }
  return parts.join("\n").trim();
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "The model did not answer within two minutes.";
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED") return "Nothing is listening at that address.";
    return err.message;
  }
  return String(err);
}

export async function testLocalLlmConnection(
  input: LocalLlmTestInput,
  fetcher: typeof fetch = fetch,
  timeoutMs: number = LOCAL_LLM_TEST_TIMEOUT_MS,
): Promise<LocalLlmTestResult> {
  const startedAt = Date.now();
  const latency = () => Date.now() - startedAt;
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  const modelId = input.modelId.trim();
  if (!isLoopbackBaseUrl(baseUrl)) {
    return { ok: false, error: "Only a local runtime on this machine can be tested.", latencyMs: 0 };
  }
  if (!modelId) {
    return { ok: false, error: "Pick a model first.", latencyMs: 0 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: LOCAL_LLM_TEST_PROMPT }],
        max_tokens: 16,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const short = detail.replace(/\s+/g, " ").trim().slice(0, 200);
      return {
        ok: false,
        error: `The runtime answered with HTTP ${res.status}${short ? `: ${short}` : "."}`,
        latencyMs: latency(),
      };
    }
    const body = await res.json().catch(() => null);
    const reply = readReplyText(body);
    if (!reply) {
      return { ok: false, error: "The runtime answered, but the model sent back no text.", latencyMs: latency() };
    }
    return { ok: true, reply: reply.slice(0, 200), latencyMs: latency() };
  } catch (err) {
    return { ok: false, error: describeError(err), latencyMs: latency() };
  } finally {
    clearTimeout(timer);
  }
}

import { isLoopbackHost } from "../../url-utils.js";
import { isChatCompletionsUrl } from "./chat-completions.js";

/**
 * Timeout floor for local/loopback runtimes. A slow LLM (esp. Ollama on modest
 * hardware) can take several minutes per turn; the wave-1 live loop hit 180s
 * timeouts three times in a row. Floor is 10 minutes (600_000 ms).
 */
export const LOCAL_MODEL_TIMEOUT_FLOOR_MS = 600_000;

/**
 * Detect a local runtime and floor its timeout to prevent wave-1 recovery loops.
 * Recognizes:
 * - A config with an explicit `localLlm` block (runtimeId, baseUrl, etc.)
 * - A loopback URL + chat-completions endpoint (e.g. http://127.0.0.1:11434/v1/chat/completions)
 *
 * For a local runtime, returns at least LOCAL_MODEL_TIMEOUT_FLOOR_MS unless the
 * hire set a longer value intentionally. For remote URLs, returns timeoutMs unchanged.
 */
export function resolveHttpAdapterTimeoutMs(config: Record<string, unknown>): number {
  const timeoutMs = typeof config.timeoutMs === "number" ? config.timeoutMs : 0;
  const url = typeof config.url === "string" ? config.url : "";
  const localLlm = config.localLlm && typeof config.localLlm === "object" ? config.localLlm : null;

  // Detect a local runtime via explicit localLlm block or loopback chat-completions URL
  const isExplicitLocal = localLlm !== null;
  const isLoopbackChat = isLoopbackChatEndpoint(url);
  const isLocal = isExplicitLocal || isLoopbackChat;

  if (!isLocal) {
    // Remote webhook: keep the original timeout as-is
    return timeoutMs;
  }

  // Local runtime: floor the timeout unless a longer value was set on purpose
  if (timeoutMs >= LOCAL_MODEL_TIMEOUT_FLOOR_MS) {
    return timeoutMs;
  }
  return LOCAL_MODEL_TIMEOUT_FLOOR_MS;
}

function isLoopbackChatEndpoint(url: string): boolean {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return isLoopbackHost(urlObj.hostname) && isChatCompletionsUrl(url);
  } catch {
    // Fallback: test the raw string if new URL() throws
    return isChatCompletionsUrl(url);
  }
}

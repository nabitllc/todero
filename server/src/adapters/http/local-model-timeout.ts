/**
 * A slow local model (Ollama, vLLM, etc.) can take minutes per turn. Without
 * a floor, the hire's 180s HTTP timeout fails prematurely, triggering
 * recovery wakes on top of each other. This module detects a local runtime
 * and guarantees a minimum timeout that survives a busy machine.
 *
 * The floor is applied at execute-time from the stored config, so it covers
 * initial runs, retries, and any derivative agent (judge, manager) that
 * inherits the config verbatim.
 */

import { LOCAL_MODEL_TIMEOUT_FLOOR_MS } from "@todero/shared";
import { isLoopbackHost } from "../../url-utils.js";
import { isChatCompletionsUrl } from "./chat-completions.js";

export { LOCAL_MODEL_TIMEOUT_FLOOR_MS };

/**
 * Resolve the effective timeout for an HTTP adapter config.
 *
 * A local runtime (detected by a `localLlm` block OR a loopback chat-completions
 * URL) gets at least the floor; a longer configured value is kept as-is; a
 * remote webhook keeps its own timeout untouched.
 *
 * @param config The adapter config (typically agent.adapterConfig)
 * @returns The effective timeout in milliseconds, or 0 if none should apply
 */
export function resolveHttpAdapterTimeoutMs(
  config: Record<string, unknown>,
): number {
  const configured = Number(config.timeoutMs) || 0;

  // Check for an explicit localLlm block (set by the wizard or backfill)
  if (config.localLlm && typeof config.localLlm === "object") {
    // Has a localLlm marker: apply the floor
    return Math.max(configured, LOCAL_MODEL_TIMEOUT_FLOOR_MS);
  }

  // Check for a loopback chat-completions URL (even without the localLlm block)
  const url = String(config.url || "");
  if (url && isChatCompletionsUrl(url)) {
    try {
      const parsed = new URL(url);
      if (isLoopbackHost(parsed.hostname)) {
        // Loopback chat endpoint: apply the floor
        return Math.max(configured, LOCAL_MODEL_TIMEOUT_FLOOR_MS);
      }
    } catch {
      // Unparseable URL: fall through to default
    }
  }

  // Remote or unknown: keep the configured value
  return configured;
}

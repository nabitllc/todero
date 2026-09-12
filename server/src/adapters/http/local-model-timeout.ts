/**
 * A local model can take minutes to answer while the machine is busy. The
 * wave-1 live loop hired an agent with a 180 s http timeout, so one task timed
 * out three times in a row and the recovery paths took over a healthy loop.
 *
 * This resolves the timeout an http adapter call actually uses: a local
 * runtime gets a floor of ten minutes whatever was written down, a longer
 * value someone set on purpose is kept, and a remote webhook keeps its own.
 *
 * The floor is applied when the call is made, from the stored config, so it
 * covers the first turn, every retry, and the judge and manager turns that
 * inherit the same config.
 */

import { LOCAL_MODEL_TIMEOUT_FLOOR_MS } from "@todero/shared";
import { isLoopbackHost } from "../../url-utils.js";
import { isChatCompletionsUrl } from "./chat-completions.js";

export { LOCAL_MODEL_TIMEOUT_FLOOR_MS };

/** A config points at a model on this machine when it says so, or when it is a loopback chat endpoint. */
export function isLocalModelAdapterConfig(config: Record<string, unknown>): boolean {
  if (config.localLlm && typeof config.localLlm === "object") return true;

  const url = typeof config.url === "string" ? config.url : "";
  if (!url) return false;
  try {
    return isLoopbackHost(new URL(url).hostname) && isChatCompletionsUrl(url);
  } catch {
    // An address we cannot parse is not treated as local: a remote webhook
    // must never pick up the floor by accident.
    return false;
  }
}

/**
 * The timeout in milliseconds an http adapter call should use for this config.
 *
 * Returns `0` (no timeout) when nothing is configured and the config is not
 * local, which is what the adapter did before this floor existed.
 */
export function resolveHttpAdapterTimeoutMs(config: Record<string, unknown>): number {
  const configured = typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) ? config.timeoutMs : 0;
  if (!isLocalModelAdapterConfig(config)) return configured;
  return Math.max(configured, LOCAL_MODEL_TIMEOUT_FLOOR_MS);
}

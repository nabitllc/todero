// Re-export from the production location for the gauntlet test.
// The gauntlet test imports from ./local-model-timeout.js (this directory),
// but the actual implementation is in adapters/http/ where execute.ts imports it.
export {
  LOCAL_MODEL_TIMEOUT_FLOOR_MS,
  resolveHttpAdapterTimeoutMs,
} from "../adapters/http/local-model-timeout.js";

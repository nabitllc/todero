/**
 * How many models this machine can serve at the same time.
 *
 * Used to decide how many runs one local agent may have in flight, and whether
 * a second agent would help or just queue behind the same GPU. Nothing here
 * installs, configures or starts anything: it reads a setting if the operator
 * set one, otherwise asks Ollama what it currently holds in memory, otherwise
 * answers 1 — the safe answer on a laptop.
 */
export const LOCAL_LLM_PARALLELISM_DEFAULT = 1;
export const LOCAL_LLM_PARALLELISM_MAX = 8;

/** The setting an operator can use to override what we detect. */
export const LOCAL_LLM_PARALLELISM_ENV_VARS = [
  "TODERO_LOCAL_LLM_PARALLELISM",
  "OLLAMA_NUM_PARALLEL",
] as const;

const PROBE_TIMEOUT_MS = 400;

function clamp(value: number): number {
  if (!Number.isFinite(value)) return LOCAL_LLM_PARALLELISM_DEFAULT;
  const floored = Math.floor(value);
  if (floored < LOCAL_LLM_PARALLELISM_DEFAULT) return LOCAL_LLM_PARALLELISM_DEFAULT;
  return Math.min(LOCAL_LLM_PARALLELISM_MAX, floored);
}

/**
 * The rule itself, with no network and no environment: a configured value
 * wins; otherwise the number of models the runtime is already holding; a
 * missing, unreadable or nonsense value means 1.
 */
export function resolveLocalLlmParallelism(input: {
  configured?: string | number | null | undefined;
  loadedModelCount?: number | null | undefined;
}): number {
  const configured = input.configured;
  if (typeof configured === "number") return clamp(configured);
  if (typeof configured === "string" && configured.trim()) {
    const parsed = Number.parseInt(configured.trim(), 10);
    if (Number.isFinite(parsed)) return clamp(parsed);
  }
  const loaded = input.loadedModelCount;
  if (typeof loaded === "number" && loaded > 0) return clamp(loaded);
  return LOCAL_LLM_PARALLELISM_DEFAULT;
}

/** The configured override, read from the first environment variable that is set. */
export function readConfiguredLocalLlmParallelism(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const name of LOCAL_LLM_PARALLELISM_ENV_VARS) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** `/api/ps` lists the models Ollama currently holds in memory. */
export function countOllamaLoadedModels(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  const models = (body as Record<string, unknown>).models;
  return Array.isArray(models) ? models.length : 0;
}

/**
 * Ask one runtime how many models it can serve at once. Only Ollama is probed;
 * every other runtime answers with the configured value or 1.
 */
export async function detectLocalLlmParallelism(input: {
  kind: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<number> {
  const configured = readConfiguredLocalLlmParallelism(input.env ?? process.env);
  if (configured) return resolveLocalLlmParallelism({ configured });
  if (input.kind !== "ollama") return LOCAL_LLM_PARALLELISM_DEFAULT;

  const fetcher = input.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetcher(`${input.baseUrl}/api/ps`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return LOCAL_LLM_PARALLELISM_DEFAULT;
    const body = await res.json().catch(() => null);
    return resolveLocalLlmParallelism({ loadedModelCount: countOllamaLoadedModels(body) });
  } catch {
    return LOCAL_LLM_PARALLELISM_DEFAULT;
  } finally {
    clearTimeout(timer);
  }
}

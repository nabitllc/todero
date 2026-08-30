/**
 * Detect local LLM runtimes already listening on this machine.
 *
 * Probes well-known localhost ports only. Does not install software, pick a
 * vendor, or start a server. A miss means nothing is up — the operator starts
 * Ollama / LM Studio / an OpenAI-compatible server themselves.
 */
export type LocalLlmRuntimeKind = "ollama" | "lmstudio" | "openai_compat";

export type LocalLlmModel = {
  id: string;
  label: string;
};

export type LocalLlmRuntime = {
  id: string;
  kind: LocalLlmRuntimeKind;
  label: string;
  baseUrl: string;
  reachable: boolean;
  models: LocalLlmModel[];
};

export type LocalLlmDetectResult = {
  runtimes: LocalLlmRuntime[];
};

const PROBE_TIMEOUT_MS = 400;
const LOOPBACK_HOST = "127.0.0.1";

type ProbeCandidate = {
  id: string;
  kind: LocalLlmRuntimeKind;
  label: string;
  port: number;
  path: string;
};

const CANDIDATES: ProbeCandidate[] = [
  { id: "ollama", kind: "ollama", label: "Ollama", port: 11434, path: "/api/tags" },
  { id: "lmstudio", kind: "lmstudio", label: "LM Studio", port: 1234, path: "/v1/models" },
  { id: "openai_compat-8080", kind: "openai_compat", label: "OpenAI-compatible", port: 8080, path: "/v1/models" },
  { id: "openai_compat-8000", kind: "openai_compat", label: "OpenAI-compatible", port: 8000, path: "/v1/models" },
  { id: "openai_compat-1337", kind: "openai_compat", label: "OpenAI-compatible", port: 1337, path: "/v1/models" },
  { id: "openai_compat-4891", kind: "openai_compat", label: "OpenAI-compatible", port: 4891, path: "/v1/models" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOllamaModels(body: unknown): LocalLlmModel[] {
  const rec = asRecord(body);
  const models = rec?.models;
  if (!Array.isArray(models)) return [];
  const out: LocalLlmModel[] = [];
  for (const entry of models) {
    const row = asRecord(entry);
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    if (!name) continue;
    out.push({ id: name, label: name });
  }
  return out;
}

function parseOpenAiModels(body: unknown): LocalLlmModel[] {
  const rec = asRecord(body);
  const data = rec?.data;
  if (!Array.isArray(data)) return [];
  const out: LocalLlmModel[] = [];
  for (const entry of data) {
    const row = asRecord(entry);
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    out.push({ id, label: id });
  }
  return out;
}

async function probeOne(
  candidate: ProbeCandidate,
  fetcher: typeof fetch,
): Promise<LocalLlmRuntime | null> {
  const baseUrl = `http://${LOOPBACK_HOST}:${candidate.port}`;
  const url = `${baseUrl}${candidate.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const rec = asRecord(body);
    if (candidate.kind === "ollama") {
      if (!Array.isArray(rec?.models)) return null;
    } else if (!Array.isArray(rec?.data)) {
      return null;
    }
    const models =
      candidate.kind === "ollama" ? parseOllamaModels(body) : parseOpenAiModels(body);
    return {
      id: candidate.id,
      kind: candidate.kind,
      label: candidate.label,
      baseUrl,
      reachable: true,
      models,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function detectLocalLlms(
  fetcher: typeof fetch = fetch,
): Promise<LocalLlmDetectResult> {
  const probed = await Promise.all(CANDIDATES.map((candidate) => probeOne(candidate, fetcher)));
  const runtimes = probed.filter((row): row is LocalLlmRuntime => row !== null);
  return { runtimes };
}

export function localLlmSelectionIsConnected(input: {
  runtimes: LocalLlmRuntime[];
  runtimeId: string | null | undefined;
  modelId: string | null | undefined;
}): boolean {
  if (!input.runtimeId || !input.modelId) return false;
  const runtime = input.runtimes.find((row) => row.id === input.runtimeId);
  if (!runtime?.reachable) return false;
  return runtime.models.some((model) => model.id === input.modelId);
}

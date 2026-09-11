import { api } from "./client";

export const LOCAL_LLM_ADAPTER_TYPE = "local_llm";

export const LOCAL_LLM_DETECT_PATH = "/todero/local-llm/detect";

export type LocalLlmRuntimeKind = "ollama" | "lmstudio" | "openai_compatible";

export type LocalLlmModel = {
  id: string;
  label: string;
};

export type LocalLlmRuntime = {
  id: string;
  kind: LocalLlmRuntimeKind;
  label: string;
  baseUrl: string;
  models: LocalLlmModel[];
  /** How many models this machine can serve at the same time. Missing means one. */
  parallelism?: number;
};

/** What the picked runtime can serve at once, or 1 when nothing said otherwise. */
export function localLlmSelectionParallelism(params: {
  runtimes: LocalLlmRuntime[];
  runtimeId: string | null | undefined;
}): number {
  const runtime = params.runtimes.find((row) => row.id === params.runtimeId);
  const reported = runtime?.parallelism;
  return typeof reported === "number" && Number.isFinite(reported) && reported >= 1
    ? Math.floor(reported)
    : 1;
}

export type LocalLlmConnectedSelection = {
  runtimeId: string;
  modelId: string;
};

export function localLlmSelectionIsConnected(params: {
  runtimes: LocalLlmRuntime[];
  runtimeId: string | null | undefined;
  modelId: string | null | undefined;
}): boolean {
  if (!params.runtimeId || !params.modelId) return false;
  const runtime = params.runtimes.find((row) => row.id === params.runtimeId);
  if (!runtime) return false;
  return runtime.models.some((model) => model.id === params.modelId);
}

/** Keep a leftover pick only when live detect currently lists that runtime+model. */
export function liveLocalLlmSelection<T extends { runtimeId: string; modelId: string }>(
  runtimes: LocalLlmRuntime[],
  selection: T | null | undefined,
): T | null {
  if (!selection) return null;
  if (
    !localLlmSelectionIsConnected({
      runtimes,
      runtimeId: selection.runtimeId,
      modelId: selection.modelId,
    })
  ) {
    return null;
  }
  return selection;
}

export const LOCAL_LLM_TEST_PATH = "/todero/local-llm/test";

export type LocalLlmTestResult =
  | { ok: true; reply: string; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

export const toderoLocalLlmApi = {
  detect: () => api.get<{ runtimes: LocalLlmRuntime[] }>(LOCAL_LLM_DETECT_PATH),
  /** One short completion against the picked model; proves it answers, not just that it is listed. */
  test: (input: { baseUrl: string; modelId: string }) =>
    api.post<LocalLlmTestResult>(LOCAL_LLM_TEST_PATH, input),
};

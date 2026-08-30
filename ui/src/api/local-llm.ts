import { api } from "./client";

export const LOCAL_LLM_ADAPTER_TYPE = "local_llm";

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
};

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

export const toderoLocalLlmApi = {
  detect: () => api.get<{ runtimes: LocalLlmRuntime[] }>("/todero/local-llm/detect"),
};

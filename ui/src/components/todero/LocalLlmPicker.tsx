import { useEffect, useState } from "react";
import {
  toderoLocalLlmApi,
  type LocalLlmRuntime,
} from "@/api/local-llm";
import { cn } from "@/lib/utils";

export type LocalLlmSelection = {
  runtimeId: string;
  runtimeLabel: string;
  baseUrl: string;
  modelId: string;
};

export type LocalLlmPickerProps = {
  value: LocalLlmSelection | null;
  onChange: (next: LocalLlmSelection | null) => void;
};

export function LocalLlmPicker({ value, onChange }: LocalLlmPickerProps) {
  const [runtimes, setRuntimes] = useState<LocalLlmRuntime[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    toderoLocalLlmApi
      .detect()
      .then((res) => {
        if (cancelled) return;
        setRuntimes(res.runtimes);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRuntimes([]);
        setError(err instanceof Error ? err.message : "Failed to detect local LLM runtimes");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Looking for a local LLM already running on this machine...</p>;
  }

  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }

  if (!runtimes || runtimes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No local LLM is running on this machine. Start Ollama, LM Studio, or another
        OpenAI-compatible server, then pick this card again - or choose Claude Code or Codex.
      </p>
    );
  }

  const selectedRuntime = runtimes.find((row) => row.id === value?.runtimeId) ?? null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Detected on this machine. Pick a runtime and a model it already has. Todero will not install anything.
      </p>
      <div className="grid grid-cols-1 gap-2">
        {runtimes.map((runtime) => (
          <button
            key={runtime.id}
            type="button"
            className={cn(
              "rounded-md border p-3 text-left text-sm transition-colors",
              value?.runtimeId === runtime.id
                ? "border-foreground bg-accent"
                : "border-border hover:bg-accent/50",
            )}
            onClick={() => {
              onChange(
                runtime.models[0]
                  ? {
                      runtimeId: runtime.id,
                      runtimeLabel: runtime.label,
                      baseUrl: runtime.baseUrl,
                      modelId: runtime.models[0].id,
                    }
                  : null,
              );
            }}
          >
            <div className="font-medium">{runtime.label}</div>
            <div className="text-xs text-muted-foreground mt-1 break-all">{runtime.baseUrl}</div>
            {runtime.models.length === 0 ? (
              <div className="text-xs text-muted-foreground mt-1">
                Reachable, but it has no models loaded yet.
              </div>
            ) : null}
          </button>
        ))}
      </div>
      {selectedRuntime && selectedRuntime.models.length > 0 ? (
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Model</span>
          <select
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            value={value?.modelId ?? ""}
            onChange={(e) => {
              if (!selectedRuntime) return;
              const modelId = e.target.value;
              onChange({
                runtimeId: selectedRuntime.id,
                runtimeLabel: selectedRuntime.label,
                baseUrl: selectedRuntime.baseUrl,
                modelId,
              });
            }}
          >
            {selectedRuntime.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

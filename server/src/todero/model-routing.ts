/**
 * Model routing: which local model a chat-only agent should use for a given
 * kind of turn.
 *
 * A local machine usually serves more than one model size at once (a
 * strongest-available "14B-class" model alongside a small, fast one). Some
 * turns are worth the slower, stronger model (planning the work, judging a
 * result); others are cheap enough that the smallest available model is fine
 * (reformatting text); the rest just use whatever the wizard set as the
 * agent's default. This module is the one place that preference lives, so it
 * does not get re-decided ad hoc at every call site.
 *
 * `available` is the flat list of model ids the local-llm detect endpoint
 * reports for the runtime in use (`LocalLlmModel.id`, e.g. `"qwen2.5-coder:14b"`).
 * Nothing here talks to a runtime directly — it only ranks strings.
 */

/** The kinds of turn a task-working loop asks a model to do. */
export type ModelRoutingTaskKind = "planning" | "judging" | "drafting" | "wrap-up" | "formatting";

/** A class of model to prefer, resolved against the models actually available. */
export type ModelClass = "strongest_local" | "fastest_local" | "wizard_default";

/** Inclusive parameter-count range (in billions) counted as "strongest local" for this loop. */
export const STRONGEST_LOCAL_MIN_B = 12;
export const STRONGEST_LOCAL_MAX_B = 16;

/**
 * Preference order per task kind: the first class that resolves to a real
 * model (from `available`) wins; `wizard_default` always resolves (it is
 * whatever the caller passes as `defaultModel`), so every kind terminates.
 */
export const MODEL_ROUTING_TABLE: Record<ModelRoutingTaskKind, ModelClass[]> = {
  planning: ["strongest_local", "wizard_default"],
  judging: ["strongest_local", "wizard_default"],
  drafting: ["wizard_default"],
  "wrap-up": ["wizard_default"],
  formatting: ["fastest_local", "wizard_default"],
};

/**
 * Parameter count in billions parsed from a model id, e.g. `"qwen2.5-coder:14b"`
 * -> 14, `"Meta-Llama-3.1-8B-Instruct"` -> 8. Returns null when no size marker
 * is present (a bare tag like `"latest"`, or a model id with no `NNb` token).
 */
export function parseModelSizeB(modelId: string): number | null {
  const match = modelId.match(/(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function pickStrongestLocal(available: string[]): string | null {
  let best: { id: string; size: number } | null = null;
  for (const id of available) {
    const size = parseModelSizeB(id);
    if (size === null || size < STRONGEST_LOCAL_MIN_B || size > STRONGEST_LOCAL_MAX_B) continue;
    if (!best || size > best.size) best = { id, size };
  }
  return best?.id ?? null;
}

function pickFastestLocal(available: string[]): string | null {
  let best: { id: string; size: number } | null = null;
  for (const id of available) {
    const size = parseModelSizeB(id);
    if (size === null) continue;
    if (!best || size < best.size) best = { id, size };
  }
  return best?.id ?? null;
}

/**
 * Which task kind a heartbeat turn is, for `context.toderoTaskKind` /
 * `pickModelForKind`. A closing turn instruction (set by the heartbeat when
 * every plan child has closed) always means wrap-up, regardless of parent —
 * that check must win over the parent check, not the other way around, or a
 * wrapping-up child task would be routed as an ordinary drafting turn.
 * Otherwise a task with a parent (created under an approved plan) is
 * drafting, and everything else is the standing conversation task.
 */
export function resolveToderoTaskKind(input: {
  turnInstructionPresent: boolean;
  hasParentIssue: boolean;
}): ModelRoutingTaskKind {
  if (input.turnInstructionPresent) return "wrap-up";
  return input.hasParentIssue ? "drafting" : "planning";
}

/**
 * Resolve a model id for one turn. `available` may be empty (no detect
 * result yet, or a non-local adapter) — every kind still falls back to
 * `defaultModel`, so callers never need a null check.
 */
export function pickModelForKind(input: {
  kind: ModelRoutingTaskKind;
  available: string[];
  defaultModel: string;
}): string {
  const preference = MODEL_ROUTING_TABLE[input.kind] ?? ["wizard_default"];
  for (const cls of preference) {
    if (cls === "wizard_default") return input.defaultModel;
    const picked = cls === "strongest_local" ? pickStrongestLocal(input.available) : pickFastestLocal(input.available);
    if (picked) return picked;
  }
  return input.defaultModel;
}

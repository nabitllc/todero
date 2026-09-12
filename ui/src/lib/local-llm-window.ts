/**
 * Gauntlet item 2: the wizard says when the model's window is too small for
 * the whole skill pack, and how to raise it.
 *
 * Ollama serves a model with a 4,096-token window unless the person raised it,
 * and the OpenAI-compatible endpoint cannot ask for more per request. The
 * skill loader gives the pack a share of the window and fits what it can,
 * highest priority first; below a certain window the agent reads only part of
 * the pack on every turn. The person can fix that in one step, so the wizard
 * says so, in plain words, the moment the connection test succeeds.
 */
import {
  SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH,
  SKILL_PACK_FULL_CHARS,
  skillPackFitsContext,
} from "@todero/shared";

export { SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH, SKILL_PACK_FULL_CHARS };

/**
 * One short paragraph for the person, or null when there is nothing to say:
 * the window is unknown, or it already carries the whole pack.
 */
export function localLlmWindowHint(input: { contextLength?: number | null }): string | null {
  const contextLength = input.contextLength;
  if (typeof contextLength !== "number" || !Number.isFinite(contextLength) || contextLength <= 0) return null;
  if (skillPackFitsContext(contextLength)) return null;
  const window = contextLength.toLocaleString("en-US");
  const target = SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH.toLocaleString("en-US");
  return (
    `This model is running with a ${window}-word window, which is too small for the whole skill pack, ` +
    `so your agent will read only part of it on each turn. ` +
    `To give it the whole pack, set OLLAMA_CONTEXT_LENGTH=${SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH} ` +
    `before starting Ollama (a ${target}-word window), then test the connection again.`
  );
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Orchestration knobs for the local-model work loop, as data rather than
 * constants scattered across `heartbeat.ts` and `issues.ts`. Nothing reads
 * this yet beyond this module's own test — it exists so the next wave that
 * adds a judge pass, a second worker, or a busy-timer wake has one place to
 * read the numbers from instead of inventing another hardcoded value next to
 * whichever function needs it.
 */
export type OrchestrationRules = {
  /** Run a judge pass right after the first plan is proposed, before approval. */
  judgeAfterFirstPlan: boolean;
  /** Hire/wake a second worker once more than this many tasks are ready with no blockers. */
  extraWorkerWhenReadyTasksAbove: number;
  /** Never run more concurrent agents than the local runtime reports models it can serve. */
  neverMoreAgentsThanModelsServed: boolean;
  /** Cap on judge -> revise round trips before a plan or a task result ships as-is. */
  maxJudgeRounds: number;
  /** Seconds an agent can stay "busy" on unblocked work before the heartbeat checks in again. */
  busyTimerSec: number;
};

export const ORCHESTRATION_RULES_DEFAULTS: OrchestrationRules = {
  judgeAfterFirstPlan: true,
  extraWorkerWhenReadyTasksAbove: 3,
  neverMoreAgentsThanModelsServed: true,
  maxJudgeRounds: 2,
  busyTimerSec: 120,
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES_FILE_PATH = path.join(moduleDir, "orchestration-rules.json");

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Loads `orchestration-rules.json` from `filePath` (defaults to the file
 * next to this module). Missing file, unreadable file, invalid JSON, or a
 * field of the wrong type all fall back to `ORCHESTRATION_RULES_DEFAULTS`
 * field-by-field — this never throws, so a bad or absent file degrades to
 * "use the defaults" rather than breaking a caller.
 */
export function loadOrchestrationRules(filePath: string = DEFAULT_RULES_FILE_PATH): OrchestrationRules {
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    raw = null;
  }
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    judgeAfterFirstPlan: readBoolean(
      record.judgeAfterFirstPlan,
      ORCHESTRATION_RULES_DEFAULTS.judgeAfterFirstPlan,
    ),
    extraWorkerWhenReadyTasksAbove: readFiniteNumber(
      record.extraWorkerWhenReadyTasksAbove,
      ORCHESTRATION_RULES_DEFAULTS.extraWorkerWhenReadyTasksAbove,
    ),
    neverMoreAgentsThanModelsServed: readBoolean(
      record.neverMoreAgentsThanModelsServed,
      ORCHESTRATION_RULES_DEFAULTS.neverMoreAgentsThanModelsServed,
    ),
    maxJudgeRounds: readFiniteNumber(record.maxJudgeRounds, ORCHESTRATION_RULES_DEFAULTS.maxJudgeRounds),
    busyTimerSec: readFiniteNumber(record.busyTimerSec, ORCHESTRATION_RULES_DEFAULTS.busyTimerSec),
  };
}

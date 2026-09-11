import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Rules about how many agents work a plan at once, kept as plain functions so
 * the decision can be read, tested and argued with on its own — no database,
 * no clock, no side effects.
 */

export type ExtraWorkerInput = {
  /** Tasks that can start right now: nothing they wait for is still open. */
  readyTasks: number;
  /** Runs already in flight for this work. */
  runningRuns: number;
  /** How many models this machine can serve at the same time. */
  parallelism: number;
  /** Agents already on this work. */
  workers: number;
};

export type ExtraWorkerDecision = {
  hire: boolean;
  /** One plain sentence, safe to show a person. */
  reason: string;
};

function count(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/**
 * Should another agent join this work?
 *
 * Yes only when all three are true:
 *
 * - somebody is already on it (this rule adds a second agent, it never hires
 *   the first one),
 * - the machine can serve another model at the same time,
 * - and there is at least one task ready to start that nobody can pick up,
 *   counting the agents already here and the runs already going.
 *
 * Otherwise the extra agent would sit idle or queue behind the same GPU, which
 * costs the person a hire and buys nothing.
 */
export function decideExtraWorker(input: ExtraWorkerInput): ExtraWorkerDecision {
  const readyTasks = count(input.readyTasks);
  const runningRuns = count(input.runningRuns);
  const parallelism = count(input.parallelism);
  const workers = count(input.workers);

  if (workers < 1) {
    return { hire: false, reason: "Nobody is on this work yet, so there is no second agent to add." };
  }
  if (parallelism <= workers) {
    return {
      hire: false,
      reason:
        parallelism <= 1
          ? "This machine runs one model at a time, so a second agent would just wait in line."
          : `This machine runs ${parallelism} models at a time and ${workers} agents are already on it.`,
    };
  }
  const unclaimed = readyTasks - runningRuns - workers;
  if (unclaimed < 1) {
    return {
      hire: false,
      reason: "Every task that can start already has an agent for it.",
    };
  }
  return {
    hire: true,
    reason: `${unclaimed} ${unclaimed === 1 ? "task" : "tasks"} can start now with nobody to pick ${unclaimed === 1 ? "it" : "them"} up.`,
  };
}

/** The features a set of tasks names, in the order they first appear. No feature counts as one. */
export function planFeatureKeys(tasks: ReadonlyArray<{ feature: string }>): string[] {
  const seen: string[] = [];
  for (const task of tasks) {
    const key = task.feature.trim().toLowerCase();
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** Tasks that can start the moment the plan is approved: nothing comes before them. */
export function countReadyPlanTasks(
  ordered: ReadonlyArray<{ blockedByTaskIds: readonly string[] }>,
): number {
  return ordered.filter((entry) => entry.blockedByTaskIds.length === 0).length;
}

/**
 * The features that have work ready the moment the plan is approved, in the
 * order that work appears. A feature whose first task waits on another feature
 * is not in this list: nobody can start it yet.
 */
export function readyPlanFeatureKeys(
  ordered: ReadonlyArray<{ task: { feature: string }; blockedByTaskIds: readonly string[] }>,
): string[] {
  return planFeatureKeys(ordered.filter((entry) => entry.blockedByTaskIds.length === 0).map((entry) => entry.task));
}

/**
 * The feature the added agent should take: the second one that has work ready
 * now. Picking by plan order instead would hand the new agent a feature whose
 * first task is still waiting, and it would sit idle from the moment it is
 * hired. Null means there is no second feature to hand over, so nobody should
 * be added.
 */
export function pickExtraWorkerFeatureKey(
  ordered: ReadonlyArray<{ task: { feature: string }; blockedByTaskIds: readonly string[] }>,
): string | null {
  return readyPlanFeatureKeys(ordered)[1] ?? null;
}

/** How many runs one agent is allowed to have in flight, read off its saved settings. */
export function readAgentParallelism(runtimeConfig: unknown): number {
  const config =
    runtimeConfig && typeof runtimeConfig === "object" ? (runtimeConfig as Record<string, unknown>) : {};
  const heartbeat =
    config.heartbeat && typeof config.heartbeat === "object"
      ? (config.heartbeat as Record<string, unknown>)
      : {};
  const raw = Number(heartbeat.maxConcurrentRuns);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.floor(raw);
}

/** The name the added agent gets, before the company de-duplicates it. */
export function buildExtraWorkerName(primaryName: string): string {
  const trimmed = primaryName.trim();
  return trimmed ? `${trimmed} 2` : "Second agent";
}

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

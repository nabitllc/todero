import type { HeartbeatRun } from "@todero/shared";

/**
 * Which path produced this run's plan. The http adapter records it on the
 * run (`toderoStructuredPlan`) whenever Todero asked a local runtime to hold
 * the reply to the plan's shape, so a person can tell an enforced plan from
 * one the model wrote by hand — and can see when the shape came back and did
 * not hold.
 */
export type StructuredPlanPath = "held" | "prose" | "unreadable";

export interface StructuredPlanPathNote {
  path: StructuredPlanPath;
  label: string;
  description: string;
}

const STRUCTURED_PLAN_PATH_NOTES: Record<StructuredPlanPath, Omit<StructuredPlanPathNote, "path">> = {
  held: {
    label: "Plan: shape held",
    description: "Todero asked the runtime for the plan's shape, and the reply came back in it.",
  },
  prose: {
    label: "Plan: written by hand",
    description:
      "Todero asked the runtime for the plan's shape; the reply came back as prose and was read the usual way.",
  },
  unreadable: {
    label: "Plan: shape did not hold",
    description:
      "The reply came back in the plan's shape but was not a plan Todero could use. The words went to the thread, never the JSON.",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readStructuredPlanPath(
  resultJson: HeartbeatRun["resultJson"] | Record<string, unknown> | null | undefined,
): StructuredPlanPathNote | null {
  const record = asRecord(resultJson);
  const value = typeof record?.toderoStructuredPlan === "string" ? record.toderoStructuredPlan : null;
  if (!value || !(value in STRUCTURED_PLAN_PATH_NOTES)) return null;
  const path = value as StructuredPlanPath;
  return { path, ...STRUCTURED_PLAN_PATH_NOTES[path] };
}

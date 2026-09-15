import type { HeartbeatRun } from "@todero/shared";
import { cn } from "@/lib/utils";
import { readStructuredPlanPath } from "../lib/structured-plan-path";

export interface RunStructuredPlanNoteProps {
  resultJson: HeartbeatRun["resultJson"] | Record<string, unknown> | null | undefined;
  className?: string;
}

/**
 * Which path produced this run's plan, on the run itself. A turn that asked
 * the runtime to hold the reply to the plan's shape and did not get one
 * finishes successfully, so the failure panel never shows it and a person
 * would otherwise have no way to tell an enforced plan from a hand-written
 * one — or to see that the shape came back and did not hold.
 */
export function RunStructuredPlanNote({ resultJson, className }: RunStructuredPlanNoteProps) {
  const planPath = readStructuredPlanPath(resultJson);
  if (!planPath) return null;
  return (
    <div
      data-testid="run-structured-plan-path"
      className={cn("rounded-lg border border-border bg-background/60 p-3 space-y-1", className)}
    >
      <div className="text-xs font-medium text-muted-foreground">{planPath.label}</div>
      <div className="text-xs text-foreground">{planPath.description}</div>
    </div>
  );
}

export default RunStructuredPlanNote;

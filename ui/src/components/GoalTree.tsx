import type { Goal } from "@todero/shared";
import { Link } from "@/lib/router";
import { StatusBadge } from "./StatusBadge";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { useState } from "react";

/** A goal row, with the task counts the list endpoint adds when it has them. */
export type GoalTreeGoal = Goal & { taskCount?: number; doneTaskCount?: number };

/**
 * How much of the work under a goal is finished, in words. Returns null when
 * the caller has no counts, so older callers render exactly as before.
 */
export function goalTaskCountLabel(goal: GoalTreeGoal): string | null {
  if (typeof goal.taskCount !== "number") return null;
  if (goal.taskCount === 0) return "No tasks";
  const done = typeof goal.doneTaskCount === "number" ? goal.doneTaskCount : 0;
  return `${done} of ${goal.taskCount} ${goal.taskCount === 1 ? "task" : "tasks"} done`;
}

/** Goal statuses in the product's words. "achieved" reads as Done to a person. */
export const GOAL_STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  active: "In progress",
  achieved: "Done",
  cancelled: "Cancelled",
};

export function goalStatusLabel(status: string): string {
  return GOAL_STATUS_LABELS[status] ?? status.replace(/[_-]/g, " ");
}

// The stored level is "company"; everywhere the owner reads it — Settings, the
// sidebar — it is called an organization. Keep the two words in step.
const GOAL_LEVEL_LABELS: Record<string, string> = {
  company: "Organization",
  team: "Team",
  feature: "Feature",
  agent: "Agent",
  task: "Task",
};

export function goalLevelLabel(level: string): string {
  return GOAL_LEVEL_LABELS[level] ?? level.replace(/[_-]/g, " ");
}

interface GoalTreeProps {
  goals: GoalTreeGoal[];
  goalLink?: (goal: GoalTreeGoal) => string;
  onSelect?: (goal: GoalTreeGoal) => void;
}

interface GoalNodeProps {
  goal: GoalTreeGoal;
  children: GoalTreeGoal[];
  allGoals: GoalTreeGoal[];
  depth: number;
  goalLink?: (goal: GoalTreeGoal) => string;
  onSelect?: (goal: GoalTreeGoal) => void;
}

function GoalNode({ goal, children, allGoals, depth, goalLink, onSelect }: GoalNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = children.length > 0;
  const link = goalLink?.(goal);
  const countLabel = goalTaskCountLabel(goal);

  const inner = (
    <>
      {hasChildren ? (
        <button
          className="p-0.5"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          aria-label={`${goal.title} subtree`}
          aria-expanded={expanded}
        >
          <ChevronRight
            className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
          />
        </button>
      ) : (
        <span className="w-4" />
      )}
      {/* Stacked on a phone so the title gets the full width instead of
          truncating to "Fill a…" behind the level and the counts. */}
      <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2">
        <span className="text-xs text-muted-foreground">{goalLevelLabel(goal.level)}</span>
        <span className="min-w-0 truncate" title={goal.title}>{goal.title}</span>
      </span>
      {countLabel ? (
        <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid="goal-task-count">
          {countLabel}
        </span>
      ) : null}
      <StatusBadge status={goal.status} label={goalStatusLabel(goal.status)} />
    </>
  );

  const classes = cn(
    "flex items-center gap-2 px-3 py-1.5 text-sm transition-colors cursor-pointer hover:bg-accent/50",
  );

  return (
    <div>
      {link ? (
        <Link
          to={link}
          className={cn(classes, "no-underline text-inherit")}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          {inner}
        </Link>
      ) : (
        <div
          className={classes}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => onSelect?.(goal)}
        >
          {inner}
        </div>
      )}
      {hasChildren && expanded && (
        <div>
          {children.map((child) => (
            <GoalNode
              key={child.id}
              goal={child}
              children={allGoals.filter((g) => g.parentId === child.id)}
              allGoals={allGoals}
              depth={depth + 1}
              goalLink={goalLink}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function GoalTree({ goals, goalLink, onSelect }: GoalTreeProps) {
  const goalIds = new Set(goals.map((g) => g.id));
  const roots = goals.filter((g) => !g.parentId || !goalIds.has(g.parentId));

  if (goals.length === 0) {
    return <p className="text-sm text-muted-foreground">No goals.</p>;
  }

  return (
    <div className="border border-border py-1">
      {roots.map((goal) => (
        <GoalNode
          key={goal.id}
          goal={goal}
          children={goals.filter((g) => g.parentId === goal.id)}
          allGoals={goals}
          depth={0}
          goalLink={goalLink}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/**
 * What the Paused card shows, computed from data the Inbox already has.
 *
 * Everything here is pure and synchronous on purpose. A paused organization
 * starts nothing, so the card cannot ask an agent what it thinks — the four
 * lists are read out of the tasks, the finished work, and the agents' budgets
 * that are already on screen.
 */
import type { Agent, HeartbeatRun, Issue } from "@todero/shared";
import { parseWorkItemDescription } from "@/components/work-item/work-item-model";

/** Seconds a task may sit unblocked before it is worth pointing at. Mirrors the orchestration rules' busy timer. */
export const QUEUED_TOO_LONG_SECONDS = 120;

/** Two rejections from the reviewer and the person should decide. Mirrors `JUDGE_MAX_FAIL_ROUNDS`. */
export const REVIEWER_ROUNDS_BEFORE_YOU_DECIDE = 2;

const JUDGE_ROUNDS_RE = /<!--\s*todero-judge-rounds:\s*(\d+)\s*-->/gi;

/** How many times the reviewer has sent this task back. Written into the description by the reviewer. */
export function readReviewerRounds(description: string | null | undefined): number {
  let rounds = 0;
  for (const match of (description ?? "").matchAll(JUDGE_ROUNDS_RE)) {
    const value = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(value) && value > rounds) rounds = value;
  }
  return rounds;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function byIdentifier(left: { identifier: string }, right: { identifier: string }) {
  return left.identifier.localeCompare(right.identifier, undefined, { numeric: true });
}

/** One line of "Was in flight". */
export type InFlightRow = {
  id: string;
  agentId: string;
  /** The task it was on, when the work named one. */
  issueId: string | null;
  /** True once it has stopped on its own. */
  finished: boolean;
};

/**
 * The work that was already under way when Pause was pressed. Two kinds
 * qualify: what is still going, and what started before the pause and has
 * stopped since — the second is how the card can say "finished" instead of
 * quietly dropping the row.
 */
export function inFlightRows(
  runs: Pick<HeartbeatRun, "id" | "agentId" | "status" | "startedAt" | "createdAt" | "finishedAt" | "contextSnapshot">[],
  pausedAt: Date | string | null | undefined,
): InFlightRow[] {
  const pausedAtDate = toDate(pausedAt);
  if (!pausedAtDate) return [];
  const rows: InFlightRow[] = [];
  for (const run of runs) {
    const startedAt = toDate(run.startedAt) ?? toDate(run.createdAt);
    // It cannot have been in flight at the pause if it had not started yet.
    if (!startedAt || startedAt.getTime() > pausedAtDate.getTime()) continue;
    const finishedAt = toDate(run.finishedAt);
    const stillGoing = run.status === "running";
    const finishedAfterThePause = finishedAt !== null && finishedAt.getTime() >= pausedAtDate.getTime();
    if (!stillGoing && !finishedAfterThePause) continue;
    const snapshot = run.contextSnapshot ?? {};
    const issueId = typeof snapshot.issueId === "string" && snapshot.issueId.trim() ? snapshot.issueId : null;
    rows.push({ id: run.id, agentId: run.agentId, issueId, finished: !stillGoing });
  }
  return rows;
}

/** One line of "Queued". */
export type QueuedRow = {
  id: string;
  identifier: string;
  title: string;
  /** The tasks this one waits for, by identifier. Empty means it can start on Play. */
  blockers: string[];
};

/**
 * The tasks that would start on Play, in the order they would go: the ones
 * that can start now first, then the ones still waiting for another task.
 * A task waiting on the person is not queued work — it belongs in "Waiting on
 * you", found the same way that list finds it — and neither is anything
 * already finished or cancelled. A blocker that has itself finished holds
 * nothing back, so the task it named counts as ready.
 */
export function queuedRows(issues: Issue[]): QueuedRow[] {
  const ready: QueuedRow[] = [];
  const waiting: QueuedRow[] = [];
  for (const issue of issues) {
    if (!issue.assigneeAgentId) continue;
    if (issue.status !== "todo" && issue.status !== "blocked") continue;
    if (parseWorkItemDescription(issue.description).waitingOnYou) continue;
    const blockers = (issue.blockedBy ?? [])
      .filter((blocker) => blocker.status !== "done" && blocker.status !== "cancelled")
      .map((blocker) => blocker.identifier ?? blocker.id);
    const row: QueuedRow = {
      id: issue.id,
      identifier: issue.identifier ?? issue.id,
      title: issue.title,
      blockers,
    };
    (blockers.length === 0 ? ready : waiting).push(row);
  }
  return [...ready.sort(byIdentifier), ...waiting.sort(byIdentifier)];
}

export type RecommendationKind = "reviewer" | "waiting" | "next" | "budget";

/** One line of "Recommendations", already pointed at the thing it is about. */
export type RecommendationRow = {
  id: string;
  kind: RecommendationKind;
  /** What to say about it, in plain words. */
  label: string;
  /** The task or agent it is about. */
  target: { kind: "issue"; identifier: string } | { kind: "agent"; agentId: string; name: string };
};

export type RecommendationInput = {
  issues: Issue[];
  agents: Agent[];
  /** Done, parentless tasks whose wrap-up named a follow-on project. */
  nextSuggestions: Array<{ issue: Issue; nextProjectName: string }>;
  /** When the organization was paused: queued time is measured up to here, not to now. */
  pausedAt: Date | string | null | undefined;
};

/**
 * The four computed recommendations, in a fixed order so the card does not
 * reshuffle under the person between refreshes: what the reviewer keeps
 * sending back, what has been waiting too long, what the last wrap-up
 * suggested next, and which agent has spent its month.
 */
export function recommendationRows(input: RecommendationInput): RecommendationRow[] {
  const rows: RecommendationRow[] = [];
  const pausedAtDate = toDate(input.pausedAt);

  const reviewer: RecommendationRow[] = [];
  const waited: RecommendationRow[] = [];
  for (const issue of input.issues) {
    const identifier = issue.identifier ?? issue.id;
    if (readReviewerRounds(issue.description) >= REVIEWER_ROUNDS_BEFORE_YOU_DECIDE) {
      reviewer.push({
        id: `reviewer:${issue.id}`,
        kind: "reviewer",
        label: `${issue.title} came back from review twice — your call now.`,
        target: { kind: "issue", identifier },
      });
      continue;
    }
    if (issue.status !== "todo" || !issue.assigneeAgentId) continue;
    const blockers = (issue.blockedBy ?? []).filter(
      (blocker) => blocker.status !== "done" && blocker.status !== "cancelled",
    );
    if (blockers.length > 0) continue;
    const since = toDate(issue.updatedAt) ?? toDate(issue.createdAt);
    if (!since || !pausedAtDate) continue;
    if (pausedAtDate.getTime() - since.getTime() < QUEUED_TOO_LONG_SECONDS * 1000) continue;
    waited.push({
      id: `waiting:${issue.id}`,
      kind: "waiting",
      label: `${issue.title} has been waiting longer than expected.`,
      target: { kind: "issue", identifier },
    });
  }
  rows.push(...reviewer.slice().sort((a, b) => a.label.localeCompare(b.label)));
  rows.push(...waited.slice().sort((a, b) => a.label.localeCompare(b.label)));

  for (const { issue, nextProjectName } of input.nextSuggestions) {
    const name = nextProjectName.trim();
    if (!name) continue;
    rows.push({
      id: `next:${issue.id}`,
      kind: "next",
      label: `The last wrap-up suggested ${name} next.`,
      target: { kind: "issue", identifier: issue.identifier ?? issue.id },
    });
  }

  for (const agent of input.agents) {
    if (agent.budgetMonthlyCents <= 0) continue;
    if (agent.spentMonthlyCents < agent.budgetMonthlyCents) continue;
    rows.push({
      id: `budget:${agent.id}`,
      kind: "budget",
      label: `${agent.name} has spent its budget for the month.`,
      target: { kind: "agent", agentId: agent.id, name: agent.name },
    });
  }

  return rows;
}

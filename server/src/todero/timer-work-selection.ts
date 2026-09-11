/**
 * What a timer tick is allowed to wake an agent for.
 *
 * The timer exists so an agent keeps going while there is work it can actually
 * start. "Can actually start" means a task assigned to it, still open, and not
 * waiting on another task that is still open. Everything else — a task blocked
 * behind a blocker, a task waiting on a person, a task nobody assigned — is not
 * a reason to spend a run.
 *
 * Kept separate from the heartbeat service so the rule can be read and tested
 * without a database.
 */

/** The statuses a timer tick may pick up. */
export const TIMER_ACTIONABLE_ISSUE_STATUSES = ["todo", "in_progress"] as const;

export type TimerWorkCandidate = {
  id: string;
  status: string;
  /** Blockers of this task that have not finished yet. */
  unresolvedBlockerCount: number;
};

const ACTIONABLE_STATUSES = new Set<string>(TIMER_ACTIONABLE_ISSUE_STATUSES);

/** True when this one task is something the timer may start work on. */
export function isActionableTimerWork(candidate: TimerWorkCandidate): boolean {
  if (!ACTIONABLE_STATUSES.has(candidate.status)) return false;
  return (candidate.unresolvedBlockerCount ?? 0) <= 0;
}

/**
 * The task a timer tick should pick, or null when the agent has nothing it can
 * start and the tick should be skipped. Candidates are taken in the order given
 * (the caller orders them; a To do task ahead of an in-progress one is still a
 * valid pick — it is the same agent either way).
 */
export function selectActionableTimerWork(
  candidates: readonly TimerWorkCandidate[],
): TimerWorkCandidate | null {
  return candidates.find(isActionableTimerWork) ?? null;
}

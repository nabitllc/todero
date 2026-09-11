/**
 * The wakes that have to follow a task closing.
 *
 * When a person closes a task the PATCH route does two things after the write:
 * it wakes whatever was queued behind it, and, once every task under a parent
 * is closed, it wakes the parent for its wrap-up. Todero can now close a task
 * on the person's behalf (the reviewer accepted the hand-in), and that write
 * goes through the issues service, not the route — so the same two wakes have
 * to be raised here or the next task never starts and the wrap-up never runs.
 *
 * Everything is injected, so the rule is testable without a database and the
 * route can adopt it later without moving any of its own idempotency logic.
 */
import {
  ISSUE_BLOCKERS_RESOLVED_WAKE_REASON,
  buildIssueBlockersResolvedWakeStateKey,
} from "./issue-dependency-wakeups.js";

export const ISSUE_CHILDREN_COMPLETED_WAKE_REASON = "issue_children_completed";

export type WakeableBlockedDependent = {
  id: string;
  assigneeAgentId: string;
  blockerIssueIds: string[];
  blockedTransitionAt?: Date | string | null;
};

export type WakeableParentAfterChildCompletion = {
  id: string;
  assigneeAgentId: string;
  childIssueIds: string[];
  childIssueSummaries?: unknown;
  childIssueSummaryTruncated?: boolean;
};

export type ClosedIssueWake = {
  source: "automation";
  triggerDetail: "system";
  reason: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  requestedByActorType: "user" | "agent" | "system";
  requestedByActorId: string | null;
  contextSnapshot: Record<string, unknown>;
};

export type ClosedIssueWakeDeps = {
  listWakeableBlockedDependents: (blockerIssueId: string) => Promise<WakeableBlockedDependent[]>;
  getWakeableParentAfterChildCompletion: (
    parentIssueId: string,
  ) => Promise<WakeableParentAfterChildCompletion | null>;
  enqueueWakeup: (agentId: string, wakeup: ClosedIssueWake) => Promise<unknown>;
  /** True when a wake for this exact ready state is already queued. */
  hasPendingDependencyWake?: (input: {
    companyId: string;
    dependentIssueId: string;
    blockerIssueIds: string[];
    blockedTransitionAt?: Date | string | null;
  }) => Promise<boolean>;
  log?: (message: string) => void;
};

export type ClosedIssueWakeResult = {
  dependentIssueIds: string[];
  parentIssueId: string | null;
};

/**
 * Raise the queued-behind and wrap-up wakes for a task that just became done.
 * A failure on one wake never stops the other: the level-triggered backstops
 * re-check both later, and losing a wake must not fail the run that closed the
 * task.
 */
export async function enqueueWakesForClosedIssue(
  deps: ClosedIssueWakeDeps,
  input: {
    issue: { id: string; companyId: string; parentId?: string | null };
    source: string;
    requestedByActorType?: "user" | "agent" | "system";
    requestedByActorId?: string | null;
  },
): Promise<ClosedIssueWakeResult> {
  const result: ClosedIssueWakeResult = { dependentIssueIds: [], parentIssueId: null };
  const requestedByActorType = input.requestedByActorType ?? "system";
  const requestedByActorId = input.requestedByActorId ?? null;

  const dependents = await deps.listWakeableBlockedDependents(input.issue.id).catch(() => []);
  for (const dependent of dependents) {
    try {
      if (deps.hasPendingDependencyWake) {
        const already = await deps
          .hasPendingDependencyWake({
            companyId: input.issue.companyId,
            dependentIssueId: dependent.id,
            blockerIssueIds: dependent.blockerIssueIds,
            blockedTransitionAt: dependent.blockedTransitionAt ?? null,
          })
          .catch(() => false);
        if (already) continue;
      }
      await deps.enqueueWakeup(dependent.assigneeAgentId, {
        source: "automation",
        triggerDetail: "system",
        reason: ISSUE_BLOCKERS_RESOLVED_WAKE_REASON,
        payload: {
          issueId: dependent.id,
          resolvedBlockerIssueId: input.issue.id,
          blockerIssueIds: dependent.blockerIssueIds,
          mutation: "blocker_done",
        },
        idempotencyKey: buildIssueBlockersResolvedWakeStateKey({
          dependentIssueId: dependent.id,
          blockerIssueIds: dependent.blockerIssueIds,
          blockedTransitionAt: dependent.blockedTransitionAt ?? null,
        }),
        requestedByActorType,
        requestedByActorId,
        contextSnapshot: {
          issueId: dependent.id,
          taskId: dependent.id,
          wakeReason: ISSUE_BLOCKERS_RESOLVED_WAKE_REASON,
          source: input.source,
          resolvedBlockerIssueId: input.issue.id,
          blockerIssueIds: dependent.blockerIssueIds,
        },
      });
      result.dependentIssueIds.push(dependent.id);
    } catch {
      deps.log?.(`[todero] Could not start the next task yet (${dependent.id}).\n`);
    }
  }

  if (!input.issue.parentId) return result;
  try {
    const parent = await deps.getWakeableParentAfterChildCompletion(input.issue.parentId);
    if (!parent) return result;
    await deps.enqueueWakeup(parent.assigneeAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: ISSUE_CHILDREN_COMPLETED_WAKE_REASON,
      payload: {
        issueId: parent.id,
        completedChildIssueId: input.issue.id,
        childIssueIds: parent.childIssueIds,
        childIssueSummaries: parent.childIssueSummaries,
        childIssueSummaryTruncated: parent.childIssueSummaryTruncated,
      },
      requestedByActorType,
      requestedByActorId,
      contextSnapshot: {
        issueId: parent.id,
        taskId: parent.id,
        wakeReason: ISSUE_CHILDREN_COMPLETED_WAKE_REASON,
        source: input.source,
        completedChildIssueId: input.issue.id,
        childIssueIds: parent.childIssueIds,
        childIssueSummaries: parent.childIssueSummaries,
        childIssueSummaryTruncated: parent.childIssueSummaryTruncated,
      },
    });
    result.parentIssueId = parent.id;
  } catch {
    deps.log?.("[todero] Could not start the wrap-up yet.\n");
  }
  return result;
}

import { useCallback } from "react";
import type { Agent, Issue } from "@todero/shared";
import { dropFor, isRefusal, type BoardColumn, type DropTask } from "../../lib/board-drop";
import { issuesApi } from "../../api/issues";
import { agentsApi } from "../../api/agents";
import { patchFromBlockedBy, workItemTypeFor } from "../work-item/work-item-adapter";
import { resolveBlockedBy } from "../work-item/work-item-model";

/** The note the board leaves behind when a person parks a task. */
export const BOARD_PARK_NOTE = "Parked from the board. What should change before this starts again?";

export type BoardDropConfig = {
  tasks: Issue[];
  agentsById: ReadonlyMap<string, Agent>;
  openChildCountById: ReadonlyMap<string, number>;
  /** The organization is paused: a start would be swallowed, so it is refused. */
  organizationPaused?: boolean;
  /** Asks the person, and calls back only on a yes. */
  onConfirm: (message: string, onYes: () => void) => void;
  onRefuse: (reason: string) => void;
  onDone?: (message: string) => void;
  onFail?: (message: string) => void;
  onRefresh?: () => void;
};

/** The task shape the drop rules need, read off a real task. */
export function dropTaskFor(args: {
  issue: Issue;
  agentsById: ReadonlyMap<string, Agent>;
  openChildCountById: ReadonlyMap<string, number>;
  organizationPaused?: boolean;
}): DropTask {
  const { issue, agentsById, openChildCountById, organizationPaused } = args;
  const blockedBy = resolveBlockedBy(issue);
  const agent = issue.assigneeAgentId ? agentsById.get(issue.assigneeAgentId) : undefined;
  return {
    id: issue.id,
    identifier: issue.identifier?.trim() || "this task",
    assigneeAgentId: issue.assigneeAgentId ?? null,
    assigneeName: agent?.name ?? null,
    assigneePaused: agent?.status === "paused",
    organizationPaused: organizationPaused === true,
    blockedByIdentifier: blockedBy?.kind === "item" ? blockedBy.identifier : null,
    openChildCount: openChildCountById.get(issue.id) ?? 0,
  };
}

/**
 * Wires the drop rules to the same calls the task page's buttons make. Accept
 * is the task page's Accept; start now is its Start now; park is the same
 * "waiting on you" the task page sets when work comes back to the person.
 */
export function useBoardDrop(config: BoardDropConfig) {
  const {
    tasks,
    agentsById,
    openChildCountById,
    organizationPaused,
    onConfirm,
    onRefuse,
    onDone,
    onFail,
    onRefresh,
  } = config;

  const handleDrop = useCallback(
    (taskId: string, from: BoardColumn, to: BoardColumn) => {
      const issue = tasks.find((candidate) => candidate.id === taskId);
      if (!issue) return;

      const task = dropTaskFor({ issue, agentsById, openChildCountById, organizationPaused });
      const result = dropFor({ task, from, to });
      if (isRefusal(result)) {
        onRefuse(result.refused);
        return;
      }
      if (result.action === "reorder") return;

      const run = async () => {
        try {
          if (result.action === "accept") {
            await issuesApi.update(issue.id, { status: "done" });
            onDone?.(`${issue.identifier} accepted.`);
          } else if (result.action === "start-now") {
            const agent = issue.assigneeAgentId ? agentsById.get(issue.assigneeAgentId) : undefined;
            if (!agent) throw new Error("Nobody is assigned to this task.");
            await issuesApi.update(issue.id, patchFromBlockedBy(null, issue, workItemTypeFor(issue)));
            await agentsApi.wakeup(
              agent.id,
              {
                source: "on_demand",
                triggerDetail: "manual",
                reason: "issue_assigned",
                payload: { issueId: issue.id },
              },
              agent.companyId,
            );
            onDone?.(`${issue.identifier} starts now.`);
          } else {
            await issuesApi.update(issue.id, {
              status: "blocked",
              ...patchFromBlockedBy({ kind: "waiting-on-you" }, issue, workItemTypeFor(issue)),
            });
            await issuesApi.addComment(issue.id, BOARD_PARK_NOTE);
            onDone?.(`${issue.identifier} is parked and waiting on you.`);
          }
          onRefresh?.();
        } catch (error) {
          onFail?.(error instanceof Error ? error.message : "That did not work. Try it from the task.");
        }
      };

      if (result.confirm) {
        onConfirm(result.confirm, () => {
          void run();
        });
        return;
      }
      void run();
    },
    [
      tasks,
      agentsById,
      openChildCountById,
      organizationPaused,
      onConfirm,
      onRefuse,
      onDone,
      onFail,
      onRefresh,
    ],
  );

  return { handleDrop };
}

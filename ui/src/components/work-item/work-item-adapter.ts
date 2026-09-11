import type { ActivityEvent, Agent, Issue, IssueComment, IssueWorkMode } from "@todero/shared";
import { ONBOARDING_FIRST_TASK_ORIGIN_KIND } from "@todero/shared";
import { createIssueDetailPath } from "@/lib/issueDetailBreadcrumb";
import { relativeTime } from "@/lib/utils";
import type { WorkItemActivityItem, WorkItemBlockedBy, WorkItemType } from "./work-item-model";
import {
  buildTrail,
  defaultWorkItemType,
  displayStatus,
  parseWorkItemDescription,
  resolveBlockedBy,
  serializeWorkItemDescription,
  staleAgentStatusCaption,
  systemAssigneeLine,
  systemStatusLine,
} from "./work-item-model";
import type { WorkItemViewProps } from "./WorkItemView";

export function isOnboardingFirstTask(issue: Partial<Pick<Issue, "originKind">>): boolean {
  return issue.originKind === ONBOARDING_FIRST_TASK_ORIGIN_KIND;
}

const MISSION_LINE_RE =
  /^(?:The company mission, as the person typed it|Company mission \(from onboarding\)):[ \t]*\n([\s\S]*?)(?:\n[ \t]*\n|$)/m;

/**
 * The first task's description is the agent's brief. The one line in it the
 * person wrote is the mission; show that and nothing else.
 */
export function missionFromFirstTaskDescription(description: string | null | undefined): string {
  const match = (description ?? "").match(MISSION_LINE_RE);
  return match?.[1]?.trim() ?? "";
}

function agentName(
  agentId: string | null | undefined,
  agentMap: Map<string, Agent>,
): string | null {
  if (!agentId) return null;
  return agentMap.get(agentId)?.name ?? null;
}

function userName(
  userId: string | null | undefined,
  userLabelMap: ReadonlyMap<string, string> | null,
): string | null {
  if (!userId) return null;
  return userLabelMap?.get(userId) ?? null;
}

/**
 * What kind of work item this is. The type is written on the item when it is
 * created — Todero marks every task it makes from an approved plan as a Task —
 * so a marked item is taken at its word. Otherwise the onboarding conversation
 * is a Brief, and only an unmarked, unplanned item falls back to its depth.
 */
export function workItemTypeFor(
  issue: Pick<Issue, "description" | "ancestors"> & Partial<Pick<Issue, "originKind">>,
): WorkItemType {
  const parsed = parseWorkItemDescription(issue.description);
  if (/<!--\s*todero-type:/i.test(issue.description ?? "")) return parsed.type;
  if (isOnboardingFirstTask(issue)) return "Brief";
  return defaultWorkItemType(issue.ancestors?.length ?? 0);
}

/**
 * A notice the product posted rather than a person or an agent: a recovery
 * notice most often. The screen shows the short headline it carries, not the
 * whole escalation, and it folds into the cluster with the other machinery —
 * but a warning one keeps its tone there, so a notice that matters still reads
 * as one when the cluster is opened.
 */
export function systemNoticeItem(comment: IssueComment): WorkItemActivityItem | null {
  const notice = comment.authorType === "system" || comment.presentation?.kind === "system_notice";
  if (!notice) return null;
  const tone = comment.presentation?.tone;
  const title = comment.presentation?.title?.trim();
  const firstLine = (comment.body ?? "").split("\n").find((line) => line.trim())?.trim() ?? "";
  return {
    id: comment.id,
    kind: "system",
    text: title || firstLine,
    ...(tone === "warning" || tone === "danger" ? { tone: "warning" as const } : {}),
  };
}

export function buildWorkItemActivity(args: {
  comments: IssueComment[];
  activity: ActivityEvent[];
  agentMap: Map<string, Agent>;
  userLabelMap: ReadonlyMap<string, string> | null;
}): WorkItemActivityItem[] {
  const items: Array<WorkItemActivityItem & { at: number }> = [];

  for (const comment of args.comments) {
    if (comment.deletedAt) continue;
    const at = new Date(comment.createdAt).getTime();
    // A notice the product posted is machinery, not anyone's words: it must
    // never be drawn as the person's own reply.
    const notice = systemNoticeItem(comment);
    if (notice) {
      items.push({ ...notice, at });
      continue;
    }
    const isAgent = comment.authorType === "agent" || Boolean(comment.authorAgentId || comment.derivedAuthorAgentId);
    if (isAgent) {
      const name =
        agentName(comment.authorAgentId ?? comment.derivedAuthorAgentId, args.agentMap) ?? "Agent";
      items.push({
        id: comment.id,
        kind: "agent",
        name,
        time: relativeTime(comment.createdAt),
        body: comment.body ?? "",
        at,
      });
      continue;
    }
    const name =
      userName(comment.authorUserId, args.userLabelMap) ??
      agentName(comment.authorAgentId, args.agentMap) ??
      "You";
    items.push({
      id: comment.id,
      kind: "human",
      name,
      time: relativeTime(comment.createdAt),
      body: comment.body ?? "",
      at,
    });
  }

  for (const event of args.activity) {
    if (event.action === "issue.comment_added") continue;
    const details = event.details ?? {};
    const at = new Date(event.createdAt).getTime();
    if (typeof details.status === "string") {
      const status = displayStatus({ status: details.status });
      items.push({
        id: event.id,
        kind: "system",
        text: systemStatusLine(status),
        at,
      });
      continue;
    }
    const assigneeAgentId = typeof details.assigneeAgentId === "string" ? details.assigneeAgentId : null;
    if (assigneeAgentId) {
      const name = agentName(assigneeAgentId, args.agentMap) ?? "agent";
      items.push({
        id: event.id,
        kind: "system",
        text: systemAssigneeLine(name),
        at,
      });
    }
  }

  items.sort((left, right) => left.at - right.at);
  return items.map(({ at: _at, ...item }) => item);
}

export function toWorkItemViewProps(args: {
  issue: Issue;
  comments: IssueComment[];
  activity: ActivityEvent[];
  agentMap: Map<string, Agent>;
  userLabelMap: ReadonlyMap<string, string> | null;
  workMode?: IssueWorkMode;
}): Omit<
  WorkItemViewProps,
  | "onTypeChange"
  | "onTitleSave"
  | "onBodySave"
  | "onStatusChange"
  | "onComment"
  | "onAttach"
  | "onWorkModeChange"
  | "onAgentNotify"
> {
  const { issue } = args;
  const parsed = parseWorkItemDescription(issue.description, workItemTypeFor(issue));
  // The onboarding first task's description is the agent's brief, written for
  // the model. The person sees the mission it carries, not the script, and
  // cannot edit it (editing would overwrite the brief).
  const firstTask = isOnboardingFirstTask(issue);
  const body = firstTask ? missionFromFirstTaskDescription(issue.description) : parsed.body;
  const status = displayStatus(issue);
  const blockedBy = resolveBlockedBy(issue);
  const assigneeId = issue.assigneeAgentId ?? (issue.assigneeUserId ? `user:${issue.assigneeUserId}` : null);
  const assigneeLabel =
    agentName(issue.assigneeAgentId, args.agentMap) ??
    userName(issue.assigneeUserId, args.userLabelMap);
  const identifier = issue.identifier?.trim() || issue.id;
  const trail = buildTrail({
    ancestors: issue.ancestors,
    id: issue.id,
    identifier: issue.identifier,
    hrefFor: createIssueDetailPath,
  });
  const agents = [...args.agentMap.values()]
    .filter((agent) => agent.status !== "terminated" && agent.status !== "pending_approval")
    .sort((left, right) => left.name.localeCompare(right.name));
  const lastAgent = [...args.comments].reverse().find(
    (comment) => comment.authorType === "agent" || Boolean(comment.authorAgentId || comment.derivedAuthorAgentId),
  );
  const agentFinished = Boolean(issue.successfulRunHandoff) || Boolean(lastAgent && status === "in_progress");

  return {
    identifier,
    type: parsed.type,
    title: issue.title,
    body,
    bodyEditable: !firstTask,
    reviewPending: parsed.reviewPending,
    planPending: parsed.planPending,
    // The agent asked something and is waiting: the turn bar says so and offers
    // the composer. It is the same marker the blocker resolver reads.
    waitingOnYou: parsed.waitingOnYou,
    blockerCount: (issue.blockedBy ?? []).length,
    // The onboarding conversation is the Brief for the whole thing; its type is
    // not a choice, so the stamp on it does not open.
    typeEditable: !firstTask,
    sections: firstTask ? [] : parsed.sections,
    checklist: parsed.checklist,
    trail,
    status,
    // The chip folds in review into In progress on purpose — there is no
    // seventh chip. The turn bar still needs the raw state, because "who acts
    // next" is the reviewer, and the board's Review column reads the same flag.
    reviewRunning: issue.status === "in_review",
    assigneeId,
    assigneeLabel,
    blockedBy,
    staleStatusCaption: staleAgentStatusCaption({
      status,
      agentName: agentName(lastAgent?.authorAgentId ?? lastAgent?.derivedAuthorAgentId ?? issue.assigneeAgentId, args.agentMap),
      agentFinished,
    }),
    activity: buildWorkItemActivity({
      comments: args.comments,
      activity: args.activity,
      agentMap: args.agentMap,
      userLabelMap: args.userLabelMap,
    }),
    agentOptions: agents.map((agent) => ({ id: agent.id, name: agent.name })),
    workMode: args.workMode ?? issue.workMode ?? "standard",
  };
}

export function descriptionWithType(
  issue: Pick<Issue, "description">,
  type: WorkItemType,
  waitingOnYou: boolean,
): string {
  const parsed = parseWorkItemDescription(issue.description, type);
  return serializeWorkItemDescription({
    type,
    waitingOnYou,
    reviewPending: parsed.reviewPending,
    planPending: parsed.planPending,
    body: parsed.body,
    sections: parsed.sections,
    checklist: parsed.checklist,
  });
}

export function descriptionWithWaitingOnYou(
  issue: Pick<Issue, "description">,
  waitingOnYou: boolean,
  type: WorkItemType,
): string {
  return descriptionWithType(issue, type, waitingOnYou);
}

export function applyBodyToDescription(
  issue: Pick<Issue, "description">,
  body: string,
  type: WorkItemType,
  waitingOnYou: boolean,
): string {
  const parsed = parseWorkItemDescription(issue.description, type);
  return serializeWorkItemDescription({
    type,
    waitingOnYou,
    reviewPending: parsed.reviewPending,
    planPending: parsed.planPending,
    body,
    sections: parsed.sections,
    checklist: parsed.checklist,
  });
}

export function patchFromBlockedBy(
  blockedBy: WorkItemBlockedBy | null,
  issue: Issue,
  type: WorkItemType,
): Record<string, unknown> {
  if (!blockedBy) {
    return {
      blockedByIssueIds: [],
      description: descriptionWithWaitingOnYou(issue, false, type),
    };
  }
  if (blockedBy.kind === "waiting-on-you") {
    return {
      blockedByIssueIds: [],
      description: descriptionWithWaitingOnYou(issue, true, type),
    };
  }
  return {
    blockedByIssueIds: [blockedBy.id],
    description: descriptionWithWaitingOnYou(issue, false, type),
  };
}

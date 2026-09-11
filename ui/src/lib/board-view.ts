import type { Agent, Goal, Issue } from "@todero/shared";
import { parseWorkItemDescription, resolveBlockedBy } from "../components/work-item/work-item-model";
import { displayStatus } from "../components/work-item/work-item-model";
import {
  BOARD_COLUMNS,
  agentRowIdFor,
  agentRowsFor,
  columnFor,
  rowIdFor,
  rowsFor,
  timeInColumnText,
  wipFor,
  type BoardColumn,
  type BoardRow,
  type BoardTaskView,
  type WipStatus,
} from "./board-model";

/** Rows by feature of the plan, or one row per agent. */
export type BoardGrouping = "feature" | "agent";

/** The one glyph a card carries, when it carries one at all. */
export type BoardCardGlyph = "writing" | "review" | "your-turn" | "paused" | null;

export interface BoardCard {
  id: string;
  identifier: string;
  title: string;
  column: BoardColumn;
  rowId: string;
  assigneeAgentId: string | null;
  assigneeName: string | null;
  glyph: BoardCardGlyph;
  /** "3 h" — how long it has stood on this step. */
  timeText: string | null;
}

export interface BoardView {
  rows: BoardRow[];
  /** Row id, then column, then the cards standing there in order. */
  cards: Map<string, Record<BoardColumn, BoardCard[]>>;
  /** Column to the agents that own the step, for the header line. */
  wip: WipStatus[];
  /** Every card by id, so a drop can find the one it is holding. */
  byId: Map<string, BoardCard>;
  totalByColumn: Record<BoardColumn, number>;
}

function emptyColumns(): Record<BoardColumn, BoardCard[]> {
  return { queued: [], working: [], review: [], "your-turn": [], done: [] };
}

/**
 * The turn view for one task, built from the same pieces the task page builds
 * it from. Exported because the board's drop handler needs the same answer.
 */
export function boardTaskViewFor(args: {
  issue: Issue;
  agentsById: ReadonlyMap<string, Agent>;
  liveIssueIds: ReadonlySet<string>;
  openChildCountById?: ReadonlyMap<string, number>;
  /** The whole organization is paused: nothing new starts until Play. */
  organizationPaused?: boolean;
}): BoardTaskView {
  const { issue, agentsById, liveIssueIds, openChildCountById, organizationPaused } = args;
  const parsed = parseWorkItemDescription(issue.description);
  const agent = issue.assigneeAgentId ? agentsById.get(issue.assigneeAgentId) : undefined;
  const working = liveIssueIds.has(issue.id);

  return {
    status: displayStatus(issue),
    blockedBy: resolveBlockedBy(issue),
    blockerCount: issue.blockedBy?.length ?? 0,
    openChildCount: openChildCountById?.get(issue.id) ?? 0,
    reviewPending: parsed.reviewPending,
    planPending: parsed.planPending,
    waitingOnYou: parsed.waitingOnYou,
    agentWorking: working,
    assigneeName: agent?.name ?? null,
    assigneeId: issue.assigneeAgentId ?? issue.assigneeUserId ?? null,
    // Two pauses reach a card. The assignee's own pause holds everything it
    // carries. An organization pause is lighter by design: nothing new starts,
    // but a turn already under way finishes on its own, so work that is live
    // right now keeps saying so rather than pretending to be queued.
    paused: agent?.status === "paused" || (organizationPaused === true && !working),
    reviewRunning: issue.status === "in_review",
  };
}

function glyphFor(view: BoardTaskView, column: BoardColumn): BoardCardGlyph {
  if (view.paused) return "paused";
  // Same order as the column: a live turn on handed-over work is the
  // reviewer's, so the card says "with the reviewer", not "writing".
  if (column === "review") return "review";
  if (view.agentWorking) return "writing";
  if (column === "your-turn") return "your-turn";
  return null;
}

/** How many still-open children each parent has, for "waiting on its own plan". */
export function openChildCounts(issues: Array<Pick<Issue, "id" | "parentId" | "status">>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    if (!issue.parentId) continue;
    if (issue.status === "done" || issue.status === "cancelled") continue;
    counts.set(issue.parentId, (counts.get(issue.parentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Everything the board draws, computed once from what the pages already load.
 * No request of its own: the issues, goals and agents are the same lists the
 * Tasks and Goals pages ask for.
 */
export function boardViewFor(args: {
  issues: Issue[];
  goals: Goal[];
  agents: Agent[];
  liveIssueIds: ReadonlySet<string>;
  groupBy?: BoardGrouping;
  /** Draw only this agent's cards. The counts per agent still read everyone. */
  agentFilter?: string | null;
  /** The organization is paused: nothing new starts until Play. */
  organizationPaused?: boolean;
  now?: number;
}): BoardView {
  const {
    issues,
    goals,
    agents,
    liveIssueIds,
    groupBy = "feature",
    agentFilter = null,
    organizationPaused = false,
    now = Date.now(),
  } = args;

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const childCounts = openChildCounts(issues);

  const rows = groupBy === "agent" ? agentRowsFor({ tasks: issues, agents }) : rowsFor({ tasks: issues, goals });
  const cards = new Map<string, Record<BoardColumn, BoardCard[]>>();
  for (const row of rows) cards.set(row.id, emptyColumns());

  const byId = new Map<string, BoardCard>();
  const columnById = new Map<string, BoardColumn>();
  const totalByColumn: Record<BoardColumn, number> = {
    queued: 0,
    working: 0,
    review: 0,
    "your-turn": 0,
    done: 0,
  };

  for (const issue of issues) {
    const view = boardTaskViewFor({
      issue,
      agentsById,
      liveIssueIds,
      openChildCountById: childCounts,
      organizationPaused,
    });
    const column = columnFor(view);
    // Every task's step is recorded, filtered out or not: the per-agent count
    // in the Agent working header must say what each agent is actually
    // carrying, not what is left after a filter for somebody else.
    columnById.set(issue.id, column);
    if (agentFilter && issue.assigneeAgentId !== agentFilter) continue;

    const rowId = groupBy === "agent" ? agentRowIdFor(issue) : rowIdFor(issue, rows);
    if (!rowId || !cards.has(rowId)) continue;

    const card: BoardCard = {
      id: issue.id,
      identifier: issue.identifier ?? issue.id,
      title: issue.title,
      column,
      rowId,
      assigneeAgentId: issue.assigneeAgentId ?? null,
      assigneeName: view.assigneeName,
      glyph: glyphFor(view, column),
      timeText: timeInColumnText(issue.updatedAt, now),
    };

    cards.get(rowId)?.[column].push(card);
    byId.set(card.id, card);
    totalByColumn[column] += 1;
  }

  const wip = wipFor({
    agents,
    tasks: issues,
    columnOf: (taskId) => columnById.get(taskId) ?? "queued",
  });

  return { rows, cards, wip, byId, totalByColumn };
}

/** The agents that own a step, for the "Review · Nova" line in the header. */
export function ownersForColumn(column: BoardColumn, view: BoardView, agents: Agent[]): string[] {
  if (column === "queued" || column === "done" || column === "your-turn") return [];
  const names = new Set<string>();
  for (const row of view.rows) {
    for (const card of view.cards.get(row.id)?.[column] ?? []) {
      const agent = card.assigneeAgentId ? agents.find((candidate) => candidate.id === card.assigneeAgentId) : undefined;
      if (agent) names.add(agent.name);
    }
  }
  return [...names];
}

export { BOARD_COLUMNS };

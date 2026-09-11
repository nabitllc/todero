import { AGENT_DEFAULT_MAX_CONCURRENT_RUNS, type Agent, type Goal, type Issue } from "@todero/shared";
import { reviewerHasIt, type TurnSentenceView } from "../components/work-item/turn-sentence";
import { workItemTypeFor } from "../components/work-item/work-item-adapter";

/**
 * The board's five steps, left to right. They are the production line the
 * organization runs, not the raw statuses: a person reads "whose turn is it",
 * and the raw status is an implementation detail underneath.
 */
export const BOARD_COLUMNS = ["queued", "working", "review", "your-turn", "done"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = {
  queued: "Queued",
  working: "Agent working",
  review: "Review",
  "your-turn": "Your turn",
  done: "Done",
};

/** The column a phone opens on: the one that might need the person. */
export const BOARD_PHONE_FIRST_COLUMN: BoardColumn = "your-turn";

/** Phone order puts Your turn first; the rest keep the desk order. */
export const BOARD_PHONE_COLUMN_ORDER: readonly BoardColumn[] = [
  "your-turn",
  "working",
  "review",
  "queued",
  "done",
];

/**
 * Everything `columnFor` needs — which is exactly what the turn bar on the task
 * page reads, `reviewRunning` included. One object feeds both, and the Review
 * column is decided by `reviewerHasIt`, the same function the bar branches on,
 * so a card in Review can never sit above a task that says the agent is still
 * writing.
 */
export type BoardTaskView = TurnSentenceView;

/**
 * Which step of the line the task is standing on.
 *
 * Precedence is `turnSentence`'s, branch for branch:
 *  1. Done and Cancelled — the task is over.
 *  2. Paused — nothing moves, so nobody owns the step: Queued.
 *  3. The reviewer has it — Review. Ahead of the live turn, because a live
 *     turn on handed-over work *is* the reviewer's, and the bar says the same.
 *  4. The agent is writing right now — Agent working.
 *  5. The person owes something — Your turn.
 *  6. Waiting on another task, or on its own children — Queued.
 *  7. Nobody owes anything: assigned work is about to start (Agent working),
 *     unassigned work is not (Queued).
 */
export function columnFor(view: BoardTaskView): BoardColumn {
  if (view.status === "done" || view.status === "cancelled") return "done";

  // A pause holds the agents' work, never the person's: something waiting on
  // the person stays in Your turn while the organization is paused.
  const personsTurn =
    Boolean(view.reviewPending) || Boolean(view.planPending) || Boolean(view.waitingOnYou) ||
    view.blockedBy?.kind === "waiting-on-you";
  if (view.paused && !personsTurn) return "queued";

  if (reviewerHasIt(view)) return "review";

  if (view.agentWorking) return "working";

  if (view.reviewPending || view.planPending) return "your-turn";
  if (view.waitingOnYou || view.blockedBy?.kind === "waiting-on-you") return "your-turn";

  if (view.blockedBy?.kind === "item") return "queued";
  if ((view.openChildCount ?? 0) > 0) return "queued";

  if (view.status === "blocked") return "queued";
  if (view.status === "new") return "queued";

  if (view.status === "in_progress") return "working";

  // To do. Assigned work is about to start; unassigned work is not work yet.
  if (view.status === "todo") return view.assigneeId ? "working" : "queued";

  return "queued";
}

export interface BoardRow {
  /** Row key: the goal id, the brief task's id, or the literal "mission". */
  id: string;
  title: string;
  kind: "brief" | "feature" | "mission";
  /** The feature's done-when, shown as the row's subtitle. */
  doneWhen: string | null;
  /** "2 of 4 done" is built from these. */
  doneCount: number;
  totalCount: number;
  /** Completed features arrive collapsed. */
  collapsedByDefault: boolean;
}

/** The least of a task the row grouping needs. */
export type BoardGroupTask = Pick<Issue, "id" | "status" | "goalId"> &
  Partial<Pick<Issue, "description" | "ancestors" | "originKind">>;

export const BOARD_MISSION_ROW_ID = "mission";
export const BOARD_MISSION_ROW_TITLE = "Mission";

/** "2 of 4 done", or "nothing yet" when the row holds no work at all. */
export function rowProgressText(doneCount: number, totalCount: number): string {
  if (totalCount <= 0) return "no tasks yet";
  return `${doneCount} of ${totalCount} done`;
}

function isFinished(status: string): boolean {
  return status === "done" || status === "cancelled";
}

/**
 * The rows, top to bottom: the Brief, then every feature goal in plan order,
 * then Mission for everything that belongs to no feature. A row with no tasks
 * and no feature behind it is not drawn at all.
 */
export function rowsFor(args: { tasks: BoardGroupTask[]; goals: Goal[] }): BoardRow[] {
  const { tasks, goals } = args;

  const featureGoals = goals.filter((goal) => goal.level === "feature");
  const featureGoalIds = new Set(featureGoals.map((goal) => goal.id));

  const briefTasks = tasks.filter((task) => workItemTypeFor({ description: task.description ?? null, ancestors: task.ancestors, originKind: task.originKind }) === "Brief");
  const briefIds = new Set(briefTasks.map((task) => task.id));

  const rows: BoardRow[] = [];

  if (briefTasks.length > 0) {
    rows.push({
      id: briefTasks[0]!.id,
      title: "Brief",
      kind: "brief",
      doneWhen: null,
      doneCount: briefTasks.filter((task) => isFinished(task.status)).length,
      totalCount: briefTasks.length,
      collapsedByDefault: false,
    });
  }

  for (const goal of featureGoals) {
    const owned = tasks.filter((task) => !briefIds.has(task.id) && task.goalId === goal.id);
    rows.push({
      id: goal.id,
      title: goal.title,
      kind: "feature",
      doneWhen: goal.description?.trim() ? goal.description.trim() : null,
      doneCount: owned.filter((task) => isFinished(task.status)).length,
      totalCount: owned.length,
      collapsedByDefault: goal.status === "achieved",
    });
  }

  const mission = tasks.filter(
    (task) => !briefIds.has(task.id) && !(task.goalId && featureGoalIds.has(task.goalId)),
  );
  if (mission.length > 0) {
    rows.push({
      id: BOARD_MISSION_ROW_ID,
      title: BOARD_MISSION_ROW_TITLE,
      kind: "mission",
      doneWhen: null,
      doneCount: mission.filter((task) => isFinished(task.status)).length,
      totalCount: mission.length,
      collapsedByDefault: false,
    });
  }

  return rows;
}

/** Which row a task belongs to, using the rows `rowsFor` just produced. */
export function rowIdFor(task: BoardGroupTask, rows: BoardRow[]): string | null {
  const brief = rows.find((row) => row.kind === "brief");
  if (brief && brief.id === task.id) return brief.id;
  const feature = rows.find((row) => row.kind === "feature" && row.id === task.goalId);
  if (feature) return feature.id;
  const mission = rows.find((row) => row.kind === "mission");
  return mission ? mission.id : null;
}

export const BOARD_UNASSIGNED_ROW_ID = "unassigned";

/**
 * The other way to read the board: one row per agent. Agents own steps rather
 * than rows, so this is the view for "what is each of them carrying", not the
 * default.
 */
export function agentRowsFor(args: {
  tasks: Array<Pick<Issue, "id" | "status"> & { assigneeAgentId?: string | null }>;
  agents: Array<Pick<Agent, "id" | "name">>;
}): BoardRow[] {
  const { tasks, agents } = args;
  const rows: BoardRow[] = [];

  for (const agent of agents) {
    const owned = tasks.filter((task) => task.assigneeAgentId === agent.id);
    if (owned.length === 0) continue;
    rows.push({
      id: agent.id,
      title: agent.name,
      kind: "feature",
      doneWhen: null,
      doneCount: owned.filter((task) => isFinished(task.status)).length,
      totalCount: owned.length,
      collapsedByDefault: false,
    });
  }

  const unassigned = tasks.filter((task) => !task.assigneeAgentId);
  if (unassigned.length > 0) {
    rows.push({
      id: BOARD_UNASSIGNED_ROW_ID,
      title: "Nobody yet",
      kind: "mission",
      doneWhen: null,
      doneCount: unassigned.filter((task) => isFinished(task.status)).length,
      totalCount: unassigned.length,
      collapsedByDefault: false,
    });
  }

  return rows;
}

/** Which agent row a task stands in. */
export function agentRowIdFor(task: { assigneeAgentId?: string | null }): string {
  return task.assigneeAgentId ?? BOARD_UNASSIGNED_ROW_ID;
}

export interface WipStatus {
  agentId: string;
  agentName: string;
  /** How many of this agent's tasks are standing in Agent working. */
  activeCount: number;
  /** What the machine can serve at once, as the agent was hired with it. */
  limit: number;
  atLimit: boolean;
}

/** What the machine will serve this agent at once. */
export function wipLimitFor(agent: Pick<Agent, "runtimeConfig">): number {
  const heartbeat = (agent.runtimeConfig as Record<string, unknown> | undefined)?.heartbeat as
    | Record<string, unknown>
    | undefined;
  const raw = heartbeat?.maxConcurrentRuns;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return AGENT_DEFAULT_MAX_CONCURRENT_RUNS;
  return Math.trunc(parsed);
}

/** "1 of 1" — the badge on the Agent working header. */
export function wipBadgeText(status: Pick<WipStatus, "activeCount" | "limit">): string {
  return `${status.activeCount} of ${status.limit}`;
}

/**
 * One entry per agent that can still take work, counting the tasks already
 * standing in Agent working. The board only reports this; the busy timer is
 * what actually refuses to start another task.
 */
export function wipFor(args: {
  agents: Agent[];
  tasks: Array<{ id: string; assigneeAgentId?: string | null }>;
  columnOf: (taskId: string) => BoardColumn;
}): WipStatus[] {
  const { agents, tasks, columnOf } = args;

  const workingByAgent = new Map<string, number>();
  for (const task of tasks) {
    const agentId = task.assigneeAgentId;
    if (!agentId) continue;
    if (columnOf(task.id) !== "working") continue;
    workingByAgent.set(agentId, (workingByAgent.get(agentId) ?? 0) + 1);
  }

  const statuses: WipStatus[] = [];
  for (const agent of agents) {
    if (agent.status === "terminated" || agent.status === "pending_approval") continue;
    const limit = wipLimitFor(agent);
    const activeCount = workingByAgent.get(agent.id) ?? 0;
    statuses.push({
      agentId: agent.id,
      agentName: agent.name,
      activeCount,
      limit,
      atLimit: activeCount >= limit,
    });
  }
  return statuses;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long the card has stood where it stands: "just now", "12 m", "3 h",
 * "2 d". Short on purpose — it is a glance, not a stopwatch.
 */
export function timeInColumnText(since: Date | string | number | null | undefined, now: number = Date.now()): string | null {
  if (since === null || since === undefined) return null;
  const at = since instanceof Date ? since.getTime() : new Date(since).getTime();
  if (!Number.isFinite(at)) return null;
  const elapsed = now - at;
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h`;
  return `${Math.floor(elapsed / DAY_MS)} d`;
}

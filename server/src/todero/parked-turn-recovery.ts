/**
 * The way back for a task that was parked with nothing on it to answer.
 *
 * Wave 4 gave a turn that produced no work one more try, at the moment that
 * turn ended. Wave 5 is about the tasks that were already parked before that
 * existed. Wave 20 reopened wave 19's organization
 * (f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3): two tasks sitting in front of a
 * person with a reply that asked them nothing, five more queued behind those
 * two, and not one turn in fifteen minutes. Nothing wakes a parked task, so the
 * corrective turn was never offered to it. Every person who updates Todero
 * while a project is running is in exactly that position.
 *
 * So the door that already runs the reviews a hold deferred does this too: it
 * finds those tasks and offers each one the same corrective turn, once. A task
 * that asked the person something, one that handed work in, one a person has
 * already answered, and one Todero has already asked once are all left exactly
 * where they are — that last one is genuinely the person's now.
 *
 * The rule is pure and sits at the top; the database reads and the doing are
 * under it, shaped like `deferred-review.ts` next door.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { agents, companies, issueComments, issues, type Db } from "@todero/db";
import type { IssueCommentPresentation } from "@todero/shared";
import { logger } from "../middleware/logger.js";
import type { ClosedIssueWake } from "../services/issue-closed-wakeups.js";
import { issueService } from "../services/issues.js";
import {
  hasDeferredReviewMarker,
  hasPlanPendingNote,
  hasReviewPendingNote,
  readEmptyTurnTries,
} from "./conversation-outcome.js";
import { hasWaitingOnYouNote } from "./conversation-thread.js";
import {
  applyEmptyTurnRecovery,
  buildEmptyTurnRetry,
  EMPTY_TURN_MAX_TRIES,
  EMPTY_TURN_RETRY_WAKE_REASON,
  turnDeliversWork,
} from "./empty-turn-recovery.js";
import { asksThePersonForAnything } from "./inputs-arrived.js";
import { isWaitingForManagerSendback } from "./manager-sendback.js";

/** Who said a thing on the task. */
export type ParkedCommentAuthor = "person" | "agent" | "system";

/** One of the last things said on a parked task. */
export type ParkedComment = {
  by: ParkedCommentAuthor;
  body: string;
};

/** A stopped task, with the last two things said on it, oldest first. */
export type ParkedTask = {
  id: string;
  companyId: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  parentId: string | null;
  assigneeAgentId: string | null;
  /** Only used to write the message if the worker cannot be brought back. */
  agentName?: string | null;
  lastComments: ParkedComment[];
};

/**
 * Does the task's own text say Todero put it in front of the person and is
 * waiting, with no other reason of its own?
 *
 * A hand-in waiting to be accepted, a hand-in a hold skipped, a plan waiting
 * for a yes and a task the manager is holding all say so in their own words,
 * and each of those is somebody else's to settle.
 */
export function parkedWithNothingElseGoingOn(description: string | null | undefined): boolean {
  if (!hasWaitingOnYouNote(description)) return false;
  return (
    !hasReviewPendingNote(description)
    && !hasPlanPendingNote(description)
    && !hasDeferredReviewMarker(description)
    && !isWaitingForManagerSendback(description)
  );
}

/**
 * Which parked tasks have nothing on them for the person to answer.
 *
 * The last thing the worker said is the whole question: if it asked for
 * something, or handed something in, the task is where it belongs. If a person
 * has spoken since, the task is already moving and is not this to touch.
 */
export function findParkedTasksWithNothingToAnswer(tasks: ParkedTask[]): ParkedTask[] {
  return tasks.filter((task) => {
    if (task.status !== "blocked") return false;
    // The conversation task's waiting is the design, and a task nobody is on
    // has nobody to bring back.
    if (!task.parentId || !task.assigneeAgentId) return false;
    if (!parkedWithNothingElseGoingOn(task.description)) return false;
    // Todero has already asked this one once. A second silent round is not
    // offered; that task really is the person's.
    if (readEmptyTurnTries(task.description) >= EMPTY_TURN_MAX_TRIES) return false;
    const said = task.lastComments;
    let turn = -1;
    for (let i = said.length - 1; i >= 0; i -= 1) {
      if (said[i]!.by === "agent") {
        turn = i;
        break;
      }
    }
    if (turn < 0) return false;
    if (said.slice(turn + 1).some((comment) => comment.by === "person")) return false;
    const reply = said[turn]!.body;
    return !asksThePersonForAnything(reply) && !turnDeliversWork(reply);
  });
}

/** How many of a task's comments the rule above needs to see. */
const COMMENTS_READ_BACK = 2;

function readParkedComment(row: {
  body: string;
  authorType: string | null;
  authorAgentId: string | null;
  presentation: IssueCommentPresentation | null;
}): ParkedComment {
  if (row.authorType === "user") return { by: "person", body: row.body };
  // Todero's own notices are written under the agent's name and marked as
  // notices. They are not a turn of the conversation, so they are not read as
  // one — but they do not hide the turn underneath them either.
  const notice = row.authorType === "system" || row.presentation?.kind === "system_notice";
  if (notice || !row.authorAgentId) return { by: "system", body: row.body };
  return { by: "agent", body: row.body };
}

async function lastThingsSaidOn(db: Db, issueId: string): Promise<ParkedComment[]> {
  const rows = await db
    .select({
      body: issueComments.body,
      authorType: issueComments.authorType,
      authorAgentId: issueComments.authorAgentId,
      presentation: issueComments.presentation,
    })
    .from(issueComments)
    .where(and(eq(issueComments.issueId, issueId), isNull(issueComments.deletedAt)))
    .orderBy(desc(issueComments.createdAt))
    .limit(COMMENTS_READ_BACK);
  return rows.reverse().map(readParkedComment);
}

/** Read a company's stopped tasks and keep the ones with nothing to answer. */
export async function loadParkedTasksWithNothingToAnswer(db: Db, companyId: string): Promise<ParkedTask[]> {
  const rows = await db
    .select({
      id: issues.id,
      companyId: issues.companyId,
      identifier: issues.identifier,
      title: issues.title,
      description: issues.description,
      status: issues.status,
      parentId: issues.parentId,
      assigneeAgentId: issues.assigneeAgentId,
      agentName: agents.name,
    })
    .from(issues)
    .leftJoin(agents, eq(issues.assigneeAgentId, agents.id))
    .where(and(eq(issues.companyId, companyId), eq(issues.status, "blocked")));

  const candidates: ParkedTask[] = [];
  for (const row of rows) {
    // The text alone rules most of them out, and reading it costs nothing.
    if (!row.parentId || !row.assigneeAgentId) continue;
    if (!parkedWithNothingElseGoingOn(row.description)) continue;
    candidates.push({ ...row, lastComments: await lastThingsSaidOn(db, row.id) });
  }
  return findParkedTasksWithNothingToAnswer(candidates);
}

export type ParkedTurnWakeup = (agentId: string, wakeup: ClosedIssueWake) => Promise<unknown>;

export type ParkedTurnRecoveryDeps = {
  enqueueWakeup: ParkedTurnWakeup;
  log?: (message: string) => unknown;
};

export type ParkedTurnTally = {
  /** Tasks taken off the person's desk and started again. */
  restarted: number;
  failed: number;
  /** Put back on hold part-way through; the rest wait for the next start. */
  stopped: boolean;
  /** A pass for this organization was already under way, so this call did nothing. */
  alreadyRunning: boolean;
};

const NOTHING_TO_DO: ParkedTurnTally = { restarted: 0, failed: 0, stopped: false, alreadyRunning: false };

/** One pass per organization at a time, for as long as that pass is running. */
const passes = new Map<string, Promise<ParkedTurnTally>>();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readCompanyStatus(db: Db, companyId: string): Promise<string | null> {
  const row = await db
    .select({ status: companies.status })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row?.status ?? null;
}

/**
 * Offer each of them the corrective turn, one at a time.
 *
 * Whether the organization is still running is asked before every single task,
 * not once at the top: a person can put it back on hold while this is half
 * done. One task that goes wrong never costs the next one its turn.
 */
export function recoverParkedTurns(
  db: Db,
  deps: ParkedTurnRecoveryDeps,
  input: { companyId: string },
): Promise<ParkedTurnTally> {
  if (passes.has(input.companyId)) return Promise.resolve({ ...NOTHING_TO_DO, alreadyRunning: true });
  const pass = runOneParkedTurnPass(db, deps, input).finally(() => {
    passes.delete(input.companyId);
  });
  passes.set(input.companyId, pass);
  return pass;
}

async function runOneParkedTurnPass(
  db: Db,
  deps: ParkedTurnRecoveryDeps,
  input: { companyId: string },
): Promise<ParkedTurnTally> {
  const log = deps.log ?? ((message: string) => logger.info({ companyId: input.companyId }, message.trim()));
  const tasks = await loadParkedTasksWithNothingToAnswer(db, input.companyId);
  if (tasks.length === 0) return NOTHING_TO_DO;
  const issuesSvc = issueService(db);
  let restarted = 0;
  let failed = 0;
  for (const task of tasks) {
    if ((await readCompanyStatus(db, input.companyId)) !== "active") {
      log(
        "[todero] The organization was put on hold again. The tasks still waiting with nothing on them"
          + " will be started when it runs once more.\n",
      );
      return { restarted, failed, stopped: true, alreadyRunning: false };
    }
    const agentId = task.assigneeAgentId;
    if (!agentId) continue;
    try {
      await applyEmptyTurnRecovery(
        {
          updateIssue: (issueId, patch) => issuesSvc.update(issueId, { ...patch, actorAgentId: agentId }),
          addComment: (issueId, body, presentation) =>
            issuesSvc.addComment(issueId, body, { agentId }, { presentation }),
          // No .catch: applyEmptyTurnRecovery puts the task back in front of
          // the person when the worker cannot be brought back, rather than
          // leaving it started with nobody on the way to it.
          wakeAgent: ({ issueId, agentId: wakeAgentId }) =>
            deps.enqueueWakeup(wakeAgentId, {
              source: "automation",
              triggerDetail: "system",
              reason: EMPTY_TURN_RETRY_WAKE_REASON,
              payload: { issueId, mutation: "update" },
              requestedByActorType: "system",
              requestedByActorId: null,
              contextSnapshot: {
                issueId,
                taskId: issueId,
                source: "issue.parked_with_nothing_to_answer",
                wakeReason: EMPTY_TURN_RETRY_WAKE_REASON,
              },
            }),
          log,
        },
        {
          issueId: task.id,
          agentId,
          recovery: buildEmptyTurnRetry({
            description: task.description,
            agentName: task.agentName ?? null,
          }),
        },
      );
      restarted += 1;
    } catch (error) {
      failed += 1;
      log(
        `[todero] Could not start ${task.identifier ?? task.title} again: ${messageOf(error)}\n`,
      );
    }
  }
  if (restarted > 0) {
    log(
      `[todero] ${restarted} task${restarted === 1 ? "" : "s"} were waiting on you with nothing to answer;`
        + " each has been asked once more for the work.\n",
    );
  }
  return { restarted, failed, stopped: false, alreadyRunning: false };
}

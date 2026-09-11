/**
 * The heartbeat side of the one-quiet-try policy: what actually happens to a
 * turn that ran out of time on a conversational agent talking to a model on
 * this machine. The decision itself is a pure function in ./slow-local-turn.ts;
 * this is the part that writes to the database.
 *
 * It lives here rather than inside heartbeat.ts on purpose. heartbeat.ts is the
 * repo's flagship over-cap file (docs/ai_context/file_size_limits.md names it),
 * and the rule there is that you extract the region you came to change rather
 * than appending to it.
 */
import { agents, heartbeatRuns, issueComments, type Db } from "@todero/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import type { issueService } from "../services/issues.js";
import { descriptionWithWaitingMarker } from "./conversation-thread.js";
import {
  planSlowLocalTurnRecovery,
  SLOW_LOCAL_TURN_HELD_NOTICE_BODY,
  SLOW_LOCAL_TURN_MAX_RETRIES,
  SLOW_LOCAL_TURN_RETRY_DELAY_MS,
  SLOW_LOCAL_TURN_RETRY_REASON,
  SLOW_LOCAL_TURN_WAKE_REASON,
} from "./slow-local-turn.js";

type RunRow = typeof heartbeatRuns.$inferSelect;
type AgentRow = typeof agents.$inferSelect;

/** The few things the heartbeat lends this policy, so it can be driven in a test. */
export type SlowLocalTurnDeps = {
  db: Db;
  issues: Pick<ReturnType<typeof issueService>, "getById" | "addComment" | "update">;
  appendRunEvent: (
    run: RunRow,
    seq: number,
    event: { eventType: string; stream?: "system"; level?: "warn"; message?: string },
  ) => Promise<unknown>;
  nextRunEventSeq: (runId: string) => Promise<number>;
  scheduleRetry: (
    run: RunRow,
    agent: AgentRow,
    opts: { retryReason: string; wakeReason: string; maxAttempts: number; delayMs: number },
  ) => Promise<unknown>;
};

/**
 * The quiet try also ran out of time. Say it once, in one sentence, and put the
 * task in front of the person the same way a handed-back turn does. Posting
 * twice is the thing this is here to prevent, so an existing notice on the task
 * stops a second one.
 */
export async function holdIssueAfterSlowLocalTurn(
  run: RunRow,
  agent: AgentRow,
  issueId: string,
  deps: SlowLocalTurnDeps,
) {
  try {
    const issue = await deps.issues.getById(issueId);
    if (!issue) return;

    const alreadySaid = await deps.db
      .select({ id: issueComments.id })
      .from(issueComments)
      .where(and(eq(issueComments.issueId, issueId), eq(issueComments.body, SLOW_LOCAL_TURN_HELD_NOTICE_BODY)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (alreadySaid) return;

    await deps.issues.addComment(issueId, SLOW_LOCAL_TURN_HELD_NOTICE_BODY, {
      agentId: agent.id,
      runId: run.id,
    });
    await deps.issues.update(issueId, {
      status: "blocked",
      description: descriptionWithWaitingMarker(issue.description ?? null, true),
      actorAgentId: agent.id,
    });
    await deps.appendRunEvent(run, await deps.nextRunEventSeq(run.id), {
      eventType: "lifecycle",
      stream: "system",
      level: "warn",
      message: "The model on this machine ran out of time twice; the task now waits for the person",
    });
  } catch (err) {
    logger.warn({ err, runId: run.id, issueId }, "failed to hold the task for the person after a slow local turn");
  }
}

/**
 * A turn that just ended. One quiet try the first time the model runs out of
 * time; if the quiet try runs out too, one plain sentence and the task waits
 * for the person. Every other turn falls through untouched.
 */
export async function applySlowLocalTurnRecovery(input: {
  outcome: string;
  run: RunRow;
  agent: AgentRow;
  issueId: string | null;
  deps: SlowLocalTurnDeps;
}) {
  const plan = planSlowLocalTurnRecovery({
    outcome: input.outcome,
    errorCode: input.run.errorCode ?? null,
    agent: input.agent,
    scheduledRetryReason: input.run.scheduledRetryReason ?? null,
  });
  if (plan === "retry_quietly") {
    await input.deps.scheduleRetry(input.run, input.agent, {
      retryReason: SLOW_LOCAL_TURN_RETRY_REASON,
      wakeReason: SLOW_LOCAL_TURN_WAKE_REASON,
      maxAttempts: SLOW_LOCAL_TURN_MAX_RETRIES,
      delayMs: SLOW_LOCAL_TURN_RETRY_DELAY_MS,
    });
    return;
  }
  if (plan === "hold_for_person" && input.issueId) {
    await holdIssueAfterSlowLocalTurn(input.run, input.agent, input.issueId, input.deps);
  }
}

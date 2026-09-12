/**
 * A chat-only conversational reply carries its own disposition, and the
 * conversation-outcome block in the heartbeat applies it: the task is closed,
 * handed back to the person, or sent to the reviewer. Nothing is left for the
 * successful-run handoff to decide, so the run records that its outcome was
 * already applied and the handoff skips instead of raising a second wake.
 *
 * The flag lives in the run's context snapshot (an existing JSON column) so a
 * later recovery sweep reading the stored row reaches the same conclusion as
 * the finalize path that stamped it.
 */
import { heartbeatRuns, type Db } from "@todero/db";
import { eq } from "drizzle-orm";

export const CONVERSATION_DISPOSITION_APPLIED_KEY = "toderoDispositionApplied";

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The same run row with the flag set, for the in-memory handoff decision. */
export function withConversationDispositionApplied<T extends { contextSnapshot?: unknown }>(
  run: T,
): T {
  return {
    ...run,
    contextSnapshot: {
      ...readRecord(run.contextSnapshot),
      [CONVERSATION_DISPOSITION_APPLIED_KEY]: true,
    },
  };
}

/** Persist the flag on the stored run. Never throws; the caller logs. */
export async function markConversationDispositionApplied(
  db: Db,
  runId: string,
): Promise<boolean> {
  const rows = await db
    .select({ contextSnapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId))
    .limit(1);
  const existing = readRecord(rows[0]?.contextSnapshot);
  if (existing[CONVERSATION_DISPOSITION_APPLIED_KEY] === true) return false;
  await db
    .update(heartbeatRuns)
    .set({
      contextSnapshot: {
        ...existing,
        [CONVERSATION_DISPOSITION_APPLIED_KEY]: true,
      },
    })
    .where(eq(heartbeatRuns.id, runId));
  return true;
}

/**
 * The same mark, with the log line the finalize path wants around it. Kept out
 * of heartbeat.ts so the two call sites there are one line each.
 */
export async function recordConversationDispositionApplied(
  db: Db,
  runId: string,
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<unknown> | unknown,
): Promise<void> {
  try {
    await markConversationDispositionApplied(db, runId);
  } catch (err) {
    await onLog(
      "stderr",
      `[todero] Could not record that the reply already chose what happens next: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

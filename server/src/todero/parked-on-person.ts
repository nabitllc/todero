/**
 * Is this task waiting on a person?
 *
 * A task Todero hands back — a question, a hand-in waiting to be read, a plan
 * waiting for a yes, a task the manager is holding — sits at "blocked", and so
 * does a task that is simply waiting for the work before it to finish. From
 * the outside the two are the same row. The difference is written in the task's
 * own text, by the code that parked it, and this is the one place that reads it.
 *
 * Why it matters: the recovery backstop wakes blocked tasks whose earlier work
 * is finished. Told apart from nothing, it woke tasks that were waiting on a
 * person instead — 13 times on ZZGAAA-3 and 13 on ZZGAAA-5 in wave 16, 30 on
 * ZZGAAA-5 in wave 17, 21 on ZZGAAAAA-3 in wave 18 — and each hand-back moved
 * the blocked timestamp, so the guard against repeating a wake never matched.
 *
 * Every note this reads is owned by the module that writes it. Nothing here
 * copies one, so a note that changes shape changes in one place.
 */
import { hasWaitingOnYouNote } from "./conversation-thread.js";
import { hasDeferredReviewMarker, hasPlanPendingNote, hasReviewPendingNote } from "./conversation-outcome.js";
import { isWaitingForManagerSendback } from "./manager-sendback.js";

/**
 * True when Todero put this task in front of a person and is waiting for an
 * answer. False for a task that is only waiting on other tasks — including a
 * conversation task blocked on its own plan's children, which is exactly the
 * task the backstop exists to wake once they close.
 */
export function isParkedOnPerson(description: string | null | undefined): boolean {
  if (!description) return false;
  return (
    hasWaitingOnYouNote(description) ||
    hasReviewPendingNote(description) ||
    hasPlanPendingNote(description) ||
    hasDeferredReviewMarker(description) ||
    isWaitingForManagerSendback(description)
  );
}

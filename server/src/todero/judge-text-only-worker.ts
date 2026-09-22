/**
 * A worker that can only write is judged on what it wrote.
 *
 * Wave 6 of the improvement loop. A wizard-hired local model talks to a chat
 * endpoint and has no tools: the whole of what it can hand in is text in a
 * reply. It cannot make a file, a PDF, a page, a layout or an export. So any
 * line of a task that asks for one of those is out of its reach by
 * construction — on every task, whatever the words — and a reviewer refusing
 * its writing for not being a document is refusing it for something it could
 * never have done.
 *
 * The answer is to tell the reviewer the truth about the teammate it is
 * reviewing, and then to take the reviewer at its word. Wave 5 answered the
 * same failure with a list of phrases matched against the task's own line
 * ("formatted", "ready for distribution"); wave 21 said "ready for
 * publication" instead and the project stopped again. A list of words against
 * a model's vocabulary leaks. What does not change is the worker's nature, so
 * that is what the sentence below is built on.
 *
 * Waves 21 and 22 also built a second half here — a guard that read a
 * refusal's words and set the refusal aside when they were all about
 * packaging. It is gone. It never once fired on a live run, and an adversarial
 * reading proved twice that it would accept unfinished work: "Two sections are
 * missing from the document." and "The discount is not in the template." both
 * read as packaging-only, and each would have turned a fair refusal into a
 * pass. Wave 22 finished a project end to end on the sentence alone. The rule
 * from here: tell the reviewer the truth about the worker, and never overrule
 * a refusal by pattern-matching the words it was written with.
 *
 * Everything here is pure.
 */
import { isConversationalHttpAgent } from "./conversation-thread.js";

/**
 * Can this worker only write?
 *
 * The same test the heartbeat uses to decide that an agent has no tools and
 * the ticket thread is its whole world. It is asked here rather than answered
 * again, so the two can never drift apart.
 */
export function isTextOnlyWorker(
  agent: { adapterType: string; adapterConfig: unknown } | null | undefined,
): boolean {
  if (!agent) return false;
  return isConversationalHttpAgent(agent);
}

/**
 * What the reviewer is told about such a worker, in place of wave 5's list of
 * phrases. It is one sentence about the worker rather than a rule about
 * particular words, which is why it holds for a line nobody has thought of yet.
 */
export const TEXT_ONLY_WORKER_NOTE =
  "The teammate who did this work can only write text in a reply. It cannot make a file, a document"
  + " format, a layout, a PDF, a page, an export or a publication. Where a line above asks for any of"
  + " those, count it met when the written content itself is complete and reads well. How the work is"
  + " formatted, what file it is in, how it is laid out or how it would be delivered is never a reason"
  + " to send it back.";

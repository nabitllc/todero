/**
 * A worker that can only write is judged on what it wrote.
 *
 * Wave 6 of the improvement loop, and three waves of the loop are behind it.
 * A wizard-hired local model talks to a chat endpoint and has no tools: the
 * whole of what it can hand in is text in a reply. It cannot make a file, a
 * PDF, a page, a layout or an export. So any line of a task that asks for one
 * of those is out of its reach by construction — on every task, whatever the
 * words — and a reviewer refusing its writing for not being a document is
 * refusing it for something it could never have done.
 *
 * Wave 5 answered the same failure with a list of phrases matched against the
 * task's own line ("formatted", "ready for distribution"). Wave 21 said "ready
 * for publication" instead and the project stopped again. A list of words
 * against a model's vocabulary leaks. What does not change is the worker's
 * nature, so that is what this is built on.
 *
 * Two halves. The brief tells the reviewer what this teammate can and cannot
 * hand in. The guard catches the reviewer that refuses it anyway: when the
 * reviewer's own reason is about format, file, layout or delivery and names
 * nothing about the content, the refused check is recorded as met on substance
 * and the verdict is worked out again from the checks that are left. A refusal
 * that names a content reason — a missing plant, wrong facts, a hand-in that
 * is a plan rather than the work — stands untouched.
 *
 * Everything here is pure.
 */
import { isConversationalHttpAgent } from "./conversation-thread.js";
import type { JudgeVerdict } from "./judge.js";

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

/** What the person reads beside a check the guard counted as met. */
export const TEXT_ONLY_WORKER_CHECK_NOTE =
  "the reviewer wanted a file or a layout; this worker can only write, and the content is here";

/** The line under the check list when the guard has changed the answer. */
export const TEXT_ONLY_WORKER_COMMENT_NOTE =
  "The reviewer asked for a file, a layout or a way of delivering this. The teammate on this task can"
  + " only write text in a reply, so that is not a reason to send the work back — the writing itself"
  + " is here.";

/**
 * Does this sentence complain about anything? A reviewer's paragraph is mostly
 * restatement; only the parts that object decide whether a refusal stands.
 */
const OBJECTION_RE =
  /\b(?:not|no|never|lacks?|lacking|missing|fails?|failed|cannot|can't|isn'?t|aren'?t|doesn'?t|don'?t|needs?|needed|must|requires?|required|without|incomplete|unfinished|only)\b/i;

/**
 * Words about how work is packaged rather than what it says. Small and written
 * out on purpose: this only has to spot the handful of things no reply in a
 * chat window can ever be.
 */
const PACKAGING_RE = new RegExp(
  `\\b(?:${[
    "format", "formats", "formatted", "formatting", "unformatted", "reformatted",
    "layout", "layouts", "laid out", "typeset", "typesetting",
    "pdf", "pdfs", "docx", "epub", "file", "files", "document format",
    "export", "exports", "exported", "exporting",
    "page design", "webpage", "web page", "website", "html", "markdown",
    "print", "printed", "printing", "printable", "print[- ]ready",
    "publish", "published", "publishing", "publication", "publications",
    "distribution", "distributed", "distribute",
    "delivery", "delivered", "deliverable", "deliverables",
    "design", "designed", "styling", "styled", "font", "fonts", "template",
    "visual", "visually", "presentation", "upload", "uploaded",
  ].join("|")})\\b`,
  "i",
);

/**
 * Words about the content itself. A sentence that names one of these is about
 * substance even when it also mentions packaging, so the refusal stands: that
 * is the line between a reviewer that wanted a PDF and one that noticed a
 * plant was missing.
 */
const CONTENT_RE = new RegExp(
  `(?:${[
    "\\bmissing\\b", "\\bincomplete\\b", "\\binaccurate\\b", "\\binaccuracies\\b",
    "\\bincorrect\\b", "\\bwrong\\b", "\\bfalse\\b", "\\buntrue\\b", "\\bempty\\b", "\\bblank\\b",
    "\\bonly (?:contains|includes|covers|has|names|mentions|lists)\\b",
    "\\b(?:does|do) not (?:include|contain|mention|cover|name|list|say|answer)\\b",
    "\\bno information\\b", "\\bnot enough (?:detail|information|content)\\b",
    "\\btoo (?:short|brief|vague|thin)\\b",
    "\\bis (?:only )?a plan\\b", "\\ba plan (?:for|to)\\b", "\\bplan rather than\\b",
    "\\bdescribes what\\b",
  ].join("|")})`,
  "i",
);

/** The reviewer's paragraph, one sentence at a time. */
function sentencesOf(note: string): string[] {
  return note
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Is every complaint in this refusal about packaging, and none of it about the
 * content? A paragraph that complains about nothing is not one of these: with
 * no stated reason there is nothing to set aside, and the refusal stands.
 */
export function refusalIsOnlyAboutPackaging(note: string | null | undefined): boolean {
  const objections = sentencesOf(note ?? "").filter((sentence) => OBJECTION_RE.test(sentence));
  if (objections.length === 0) return false;
  if (objections.some((sentence) => CONTENT_RE.test(sentence))) return false;
  return objections.every((sentence) => PACKAGING_RE.test(sentence));
}

export type TextOnlyWorkerAllowance = {
  verdict: JudgeVerdict;
  checks: boolean[] | null;
  /** Per check, true where this guard turned a "not met" into a "met". */
  allowed: boolean[];
};

/**
 * The guard. A send-back from the reviewer of a worker that can only write,
 * whose whole stated reason is that the work is not a file or a layout, is not
 * a send-back: each check it refused on that reason is recorded as met on
 * substance, and the verdict is worked out again from the answers that are
 * then on the board.
 *
 * A reviewer that never said which checks it made has nothing left to work the
 * verdict out from, so its refusal simply falls away with its reason.
 */
export function applyTextOnlyWorkerAllowance(input: {
  workerIsTextOnly: boolean;
  verdict: JudgeVerdict;
  note: string;
  checks: boolean[] | null;
}): TextOnlyWorkerAllowance {
  const untouched: TextOnlyWorkerAllowance = {
    verdict: input.verdict,
    checks: input.checks,
    allowed: (input.checks ?? []).map(() => false),
  };
  if (!input.workerIsTextOnly) return untouched;
  if (input.verdict !== "fail") return untouched;
  if (!refusalIsOnlyAboutPackaging(input.note)) return untouched;
  if (!input.checks) return { verdict: "pass", checks: null, allowed: [] };
  const allowed = input.checks.map((met) => !met);
  const checks = input.checks.map(() => true);
  return { verdict: checks.every(Boolean) ? "pass" : "fail", checks, allowed };
}

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
 * nature, so that is what this is built on. Wave 5's list is kept for the one
 * job the sentence about the worker cannot do: saying which of the task's own
 * written-down lines is the one out of reach, so that the guard below answers
 * that line and no other.
 *
 * Two halves. The brief tells the reviewer what this teammate can and cannot
 * hand in, and that is the half that does the work. The guard underneath is
 * the narrow safety net: it only ever sets a refusal aside when every word of
 * what the reviewer complained about is about packaging, and it only ever
 * counts as met the lines that themselves asked for packaging. Anything else
 * — a refusal that names the writing, a sentence that asks for a layout and a
 * missing fact in one breath, a line about the content the reviewer marked not
 * met — stands exactly as the reviewer left it. Guessing wrong here accepts
 * unfinished work in a person's name, so every unrecognized shape is a no.
 *
 * Everything here is pure.
 */
import { isConversationalHttpAgent } from "./conversation-thread.js";
import { namesPackaging } from "./judge-feature-work.js";
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
 * Every word a reviewer complains with. Wide on purpose: each one of these
 * found in a sentence has to turn out to be part of a complaint this can read
 * and that is only about packaging. One it cannot place — "it omits the fourth
 * guide", "the draft is short of detail" — and the refusal stands whatever
 * else the sentence says.
 */
const COMPLAINT_WORDS_RE = new RegExp(
  `\\b(?:${[
    "not", "no", "never", "nothing", "none",
    "lacks?", "lacking", "lacked", "missing", "misses",
    "fails?", "failed", "cannot", "can'?t",
    "isn'?t", "aren'?t", "wasn'?t", "weren'?t", "doesn'?t", "don'?t", "didn'?t",
    "needs?", "needed", "must", "requires?", "required", "should",
    "without", "incomplete", "unfinished", "only",
    "omits?", "omitted", "omission", "excludes?", "excluded",
    "ignores?", "ignored", "skips?", "skipped", "neglects?", "overlooks?", "forgets?",
    "unclear", "vague", "insufficient", "inadequate", "superficial", "thin",
    "short", "brief", "sparse", "partial", "limited", "poor", "weak",
    "wrong", "incorrect", "inaccurate", "false", "untrue", "empty", "blank",
  ].join("|")})\\b`,
  "gi",
);

/**
 * Where a complaint's subject starts. Everything from one of these to the end
 * of the sentence is the thing the reviewer is complaining about, and that is
 * what has to be about packaging — not the sentence as a whole. This is the
 * difference between "it is not formatted" and "the formatting of the argument
 * is not clear", which name the same word and mean opposite things.
 *
 * Longest first, so "is not" wins over the "not" inside it.
 */
const COMPLAINT_SUBJECT_RE = new RegExp(
  `\\b(?:${[
    "has not(?: yet)? been", "have not(?: yet)? been", "had not been",
    "hasn'?t been", "haven'?t been",
    "is not(?: yet)?", "are not(?: yet)?", "was not", "were not",
    "isn'?t", "aren'?t", "wasn'?t", "weren'?t",
    "does not", "do not", "did not", "doesn'?t", "don'?t", "didn'?t",
    "cannot", "can'?t",
    "needs? to be", "needs? to", "must be", "should be",
    "requires?", "required",
    "lacks?", "lacking", "lacked", "missing",
    "without", "never", "not", "no",
  ].join("|")})\\b`,
  "gi",
);

/**
 * The words that mean how work is packaged rather than what it says. Written
 * out on purpose: this only has to name the handful of things no reply in a
 * chat window can ever be.
 */
const PACKAGING_WORDS = new Set([
  "format", "formats", "formatted", "formatting", "unformatted", "reformat", "reformatted",
  "layout", "layouts", "laid", "typeset", "typesetting",
  "pdf", "pdfs", "docx", "epub", "file", "files", "document", "documents",
  "export", "exports", "exported", "exporting",
  "page", "pages", "webpage", "webpages", "website", "html", "markdown",
  "print", "printed", "printing", "printable", "printout",
  "publish", "published", "publishing", "publication", "publications", "publishable",
  "distribution", "distributed", "distribute", "distributable",
  "delivery", "deliver", "delivered", "deliverable", "deliverables",
  "design", "designed", "designs", "style", "styled", "styling", "stylesheet",
  "font", "fonts", "typography",
  "template", "templates", "visual", "visuals", "visually",
  "presentation", "presentations", "upload", "uploaded", "uploading",
  "attachment", "attachments",
]);

/**
 * Words that carry no subject of their own — the scaffolding a complaint is
 * built out of. A word that is neither one of these nor a packaging word is
 * something about the work itself, and its presence is what makes a refusal
 * stand. Adding a word here widens the guard, so nothing goes in that could
 * name a part of what was written.
 */
const FILLER_WORDS = new Set([
  "a", "an", "the", "any", "all", "some", "this", "that", "these", "those",
  "it", "its", "they", "them", "their", "there", "here", "one", "more", "most",
  "much", "very", "too", "so", "such", "then", "than", "as", "at", "by", "for",
  "from", "in", "into", "of", "on", "onto", "or", "and", "to", "with", "within",
  "without", "up", "out", "over", "under", "about", "because", "way", "ways",
  "well", "enough", "still", "yet", "simply", "merely", "only", "just",
  "currently", "actually", "really", "also", "additionally", "however",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "has", "have", "had", "can", "could", "will", "would", "shall", "should",
  "may", "might", "must", "need", "needs", "needed",
  "lack", "lacks", "lacking", "lacked", "not", "no", "never", "nor", "but",
  "which", "what", "how", "when", "where", "who", "whose", "if", "while",
  "ready", "proper", "properly", "suitable", "suitably", "appropriate",
  "appropriately",
]);

/** The reviewer's paragraph, one sentence at a time. */
function sentencesOf(note: string): string[] {
  return note
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Every place in this sentence where a complaint's subject begins. */
function complaintsIn(sentence: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  COMPLAINT_SUBJECT_RE.lastIndex = 0;
  for (let match = COMPLAINT_SUBJECT_RE.exec(sentence); match; match = COMPLAINT_SUBJECT_RE.exec(sentence)) {
    found.push({ start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/** Is everything in this stretch of words about how the work is packaged? */
function readsAsPackaging(text: string): boolean {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 0);
  if (words.length === 0) return false;
  if (!words.some((word) => PACKAGING_WORDS.has(word))) return false;
  return words.every((word) => PACKAGING_WORDS.has(word) || FILLER_WORDS.has(word));
}

/**
 * Is everything this sentence complains about a matter of packaging?
 *
 * Three things have to hold, and all three are written so that anything this
 * cannot account for is a no. The sentence has to complain about something at
 * all. Every word it complains with has to belong to a complaint this can read
 * — "it omits the fourth guide and is not formatted for publication" is turned
 * down here, because "omits" sits outside every complaint this knows and the
 * missing guide would otherwise go unseen. And from each complaining word to
 * the end of the sentence there has to be a packaging word and nothing that
 * names a part of the work: a total, a plant, a conclusion, a draft.
 */
function sentenceIsOnlyAboutPackaging(sentence: string): boolean {
  const complaints = complaintsIn(sentence);
  if (complaints.length === 0) return false;
  COMPLAINT_WORDS_RE.lastIndex = 0;
  for (let word = COMPLAINT_WORDS_RE.exec(sentence); word; word = COMPLAINT_WORDS_RE.exec(sentence)) {
    const at = word.index;
    if (!complaints.some((complaint) => at >= complaint.start && at < complaint.end)) return false;
  }
  return complaints.every((complaint) => readsAsPackaging(sentence.slice(complaint.end)));
}

/**
 * Is the whole of this refusal about packaging? Every sentence of it has to
 * be. A sentence that complains about nothing — a line of preamble, a sentence
 * about the writing, a reviewer thinking aloud — leaves the refusal standing:
 * this cannot tell a harmless aside from a second reason, so it does not try.
 * Narrow is the point. The reviewer's brief is what keeps these refusals from
 * being written; this only catches the one that is written anyway and says
 * nothing but "it is not a document".
 */
export function refusalIsOnlyAboutPackaging(note: string | null | undefined): boolean {
  const sentences = sentencesOf(note ?? "");
  if (sentences.length === 0) return false;
  return sentences.every(sentenceIsOnlyAboutPackaging);
}

export type TextOnlyWorkerAllowance = {
  verdict: JudgeVerdict;
  checks: boolean[] | null;
  /** Per check, true where this guard turned a "not met" into a "met". */
  allowed: boolean[];
};

/**
 * The guard. A send-back from the reviewer of a worker that can only write,
 * whose whole stated reason is that the work is not a file or a layout, does
 * not stand against the lines that asked for a file or a layout: each of those
 * the reviewer marked not met is recorded as met on substance, and the verdict
 * is worked out again from every answer then on the board. A line about the
 * writing that the reviewer marked not met is left not met, and the send-back
 * with it.
 *
 * When the reviewer never said which checks it made there is nothing to work a
 * verdict out from, so its refusal falls away with its reason — but only when
 * one of the task's own lines asked for something this worker cannot make. If
 * none did, the reviewer was complaining about something nobody asked for and
 * the refusal is left alone rather than guessed at.
 */
export function applyTextOnlyWorkerAllowance(input: {
  workerIsTextOnly: boolean;
  verdict: JudgeVerdict;
  note: string;
  checks: boolean[] | null;
  /** The written-down lines the answers belong to, in the same order. */
  checkTexts?: string[];
}): TextOnlyWorkerAllowance {
  const untouched: TextOnlyWorkerAllowance = {
    verdict: input.verdict,
    checks: input.checks,
    allowed: (input.checks ?? []).map(() => false),
  };
  if (!input.workerIsTextOnly) return untouched;
  if (input.verdict !== "fail") return untouched;
  if (!refusalIsOnlyAboutPackaging(input.note)) return untouched;
  const texts = input.checkTexts ?? [];
  if (!input.checks) {
    return texts.some(namesPackaging) ? { verdict: "pass", checks: null, allowed: [] } : untouched;
  }
  // Without the lines themselves there is no way to tell which answer the
  // reviewer's reason belongs to, and flipping all of them would accept work
  // on a line nobody looked at.
  if (texts.length !== input.checks.length) return untouched;
  const allowed = input.checks.map((met, index) => !met && namesPackaging(texts[index] ?? ""));
  if (!allowed.some(Boolean)) return untouched;
  const checks = input.checks.map((met, index) => met || allowed[index]!);
  return { verdict: checks.every(Boolean) ? "pass" : "fail", checks, allowed };
}

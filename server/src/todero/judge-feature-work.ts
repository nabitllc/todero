/**
 * What the reviewer is told about the rest of the feature, and about a line no
 * chat reply can ever satisfy.
 *
 * Wave 5 of the improvement loop, and both halves come from one failure. In
 * wave 20 (organization 42c3d5e4) the feature "Review and Editing" had two
 * tasks. The first handed in four edited guides and was accepted. The second
 * handed in those same guides and was refused twice — once for "have been
 * reviewed and edited", which the first task had already done and nobody had
 * told the reviewer about, and once for "formatted and ready for
 * distribution", which no plain-text hand-in can show at all. The project
 * stopped on that one task.
 *
 * Everything here is pure, and it is kept beside `judge.ts` rather than in it
 * because that file is at its size limit.
 */
import { shortenedInputMarker, taskInputLabel } from "../adapters/http/prompt-budget.js";

/**
 * One task of the same feature that finished before this one and whose work
 * was accepted. The last task of a feature is the one held to the feature's
 * finish line, and most of that line was made true by the tasks before it — so
 * the reviewer is shown them rather than left to assume none exist.
 */
export type AcceptedFeatureWork = {
  identifier: string | null;
  title: string;
  /** What it handed in, as the reviewer will read it. */
  output: string;
};

/**
 * How much of an earlier task's work the reviewer is shown. The reviewer's own
 * reply is capped at a few hundred tokens and its whole brief is meant to stay
 * short, so this is a fixed number of characters rather than a share of a
 * window — but it is cut the same way, and says the same thing where it was
 * cut, as the block a worker is given.
 */
export const ACCEPTED_WORK_MAX_CHARS = 1_500;

/** How an earlier task is named above its work: "ZZ-4 — Review the drafts". */
function acceptedWorkLabel(work: AcceptedFeatureWork): string {
  return taskInputLabel({ identifier: work.identifier, title: work.title, body: work.output });
}

function clipAcceptedWork(work: AcceptedFeatureWork): string {
  const body = work.output.trim();
  if (body.length <= ACCEPTED_WORK_MAX_CHARS) return body;
  return `${body.slice(0, ACCEPTED_WORK_MAX_CHARS)}\n${shortenedInputMarker(acceptedWorkLabel(work))}`;
}

/**
 * The part of the reviewer's brief that says what the rest of the feature
 * already did. Empty when there is nothing to say, so a task whose feature has
 * not finished anything yet is asked exactly what it was asked before.
 */
export function buildAcceptedWorkLines(acceptedWork: AcceptedFeatureWork[] | undefined): string[] {
  const accepted = (acceptedWork ?? []).filter((work) => work.output.trim());
  if (accepted.length === 0) return [];
  const lines = ["", "Already done on this feature, and accepted:"];
  for (const work of accepted) {
    lines.push("", `${acceptedWorkLabel(work)} handed in:`, '"""', clipAcceptedWork(work), '"""');
  }
  lines.push(
    "",
    "That work is finished and counts as done. Anything the done-when line asks for that one of"
      + " those tasks already did is met here too, unless what was handed in below undoes it."
      + " Judge this task on what it alone was asked to hand in.",
  );
  return lines;
}

/**
 * Lines about packaging rather than substance.
 *
 * A chat-only agent hands in text. "Formatted and ready for distribution" is
 * about how that text would be laid out on a page, which a text reply cannot
 * show at all, so a small reviewer reads plain prose and answers "not
 * formatted" every single time.
 *
 * The list is written out on purpose. Working out what a sentence is really
 * asking for is the reviewer's job; this only has to spot the handful of
 * phrases that no reply in a chat window can ever satisfy.
 */
const PACKAGING_RE = new RegExp(
  `\\b(?:${[
    "formatted",
    "formatting",
    "reformatted",
    "laid out",
    "typeset",
    "typesetting",
    "exported",
    "print[- ]ready",
    "publication[- ]ready",
    "camera[- ]ready",
    "ready (?:for|to) (?:distribution|distribute|publishing|publication|publish|print|printing|release)",
  ].join("|")})\\b`,
  "i",
);

/** True when this line asks for packaging a text hand-in cannot display. */
export function namesPackaging(line: string | null | undefined): boolean {
  return PACKAGING_RE.test(line ?? "");
}

/** The sentence that puts a packaging line back onto substance. */
export const PACKAGING_NOTE =
  "What was handed in is plain text, so it cannot show how anything is laid out."
  + " Where a line above asks for work formatted, laid out, exported or ready to publish,"
  + " count that met when the content itself is complete and reads well.";

/** Two lines read the same way once spacing, case and a full stop are set aside. */
function sameLine(left: string, right: string): boolean {
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim().replace(/\.$/, "").toLowerCase();
  const a = normalize(left);
  return a.length > 0 && a === normalize(right);
}

/**
 * Which of the written-down checks an earlier accepted task already made true,
 * and who made it true. Only the feature's finish line can be one: every other
 * check is this task's own hand-in line, which nobody else can have handed in.
 */
export function checksAlreadyDone(input: {
  checks: string[];
  doneWhen?: string | null;
  acceptedWork?: AcceptedFeatureWork[];
}): (string | null)[] {
  const names = (input.acceptedWork ?? [])
    .map((work) => work.identifier?.trim() || work.title.trim())
    .filter((name) => name.length > 0);
  const doneWhen = (input.doneWhen ?? "").trim();
  if (names.length === 0 || !doneWhen) return input.checks.map(() => null);
  const said = names.join(" and ");
  return input.checks.map((check) => (sameLine(check, doneWhen) ? said : null));
}

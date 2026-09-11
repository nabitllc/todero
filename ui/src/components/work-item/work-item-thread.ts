/**
 * The conversation, shaped before it is drawn. Three passes, all pure, so the
 * thread component never has to decide anything:
 *
 *  1. A reviewer's reply is not a reply — it is a verdict, and it gets its own
 *     card. Reading it back out of the text is the only way the screen can tell
 *     the two apart: the reviewer posts under its own name like anyone else.
 *  2. The reply that came with a hand-in is not a reply either. The output has
 *     its own tab now, so the conversation keeps only the one line that opens
 *     it. A reply that asks a question or proposes a plan stays in full.
 *  3. Consecutive machinery lines collapse into one grey line.
 *
 * Step 2 keys off the last agent reply rather than the text, because the
 * comment the agent leaves on a hand-in is the same summary that becomes the
 * Output document (`buildHeartbeatRunIssueComment` on the server), and the
 * server clips it: comparing the two strings would miss on any long hand-in.
 */
import { clusterThread } from "./work-item-cluster";
import type { WorkItemActivityItem } from "./work-item-model";
import { parseVerdictFromComment } from "./work-item-verdict";

/** A reviewer's reply becomes a verdict item; everything else is left alone. */
export function markVerdicts(entries: WorkItemActivityItem[]): WorkItemActivityItem[] {
  return entries.map((entry) => {
    if (entry.kind !== "agent") return entry;
    const verdict = parseVerdictFromComment({ body: entry.body ?? entry.text ?? "" });
    return verdict ? { ...entry, kind: "verdict" as const, verdict } : entry;
  });
}

/**
 * The last agent reply becomes the one-line "Handed in version N · Open" card.
 * Only while the hand-in is actually waiting, and only when there is a version
 * to open: with no output document the reply is all the person has, so it stays.
 */
export function markHandIn(
  entries: WorkItemActivityItem[],
  args: { reviewPending: boolean; version: number | null },
): WorkItemActivityItem[] {
  if (!args.reviewPending || !args.version) return entries;
  const last = entries.map((entry) => entry.kind).lastIndexOf("agent");
  if (last < 0) return entries;
  return entries.map((entry, index) =>
    index === last ? { ...entry, kind: "handed-in" as const, version: args.version ?? undefined } : entry,
  );
}

/** The thread as the conversation tab draws it, top to bottom. */
export function buildThreadItems(args: {
  activity: WorkItemActivityItem[];
  reviewPending?: boolean;
  handedInVersion?: number | null;
}): WorkItemActivityItem[] {
  const verdicts = markVerdicts(args.activity);
  const handIn = markHandIn(verdicts, {
    reviewPending: Boolean(args.reviewPending),
    version: args.handedInVersion ?? null,
  });
  return clusterThread(handIn);
}

/**
 * The verdict the reviewer left last, if it left one. The review card reads it
 * so the card and the verdict never say different things about the same work.
 */
export function lastVerdict(entries: WorkItemActivityItem[]): WorkItemActivityItem | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind === "verdict") return entry;
  }
  return null;
}

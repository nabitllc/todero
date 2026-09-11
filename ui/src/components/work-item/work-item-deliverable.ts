/**
 * The versions of a hand-in, and the one line that names each of them.
 *
 * A document's revisions come back oldest-first from the API and the picker
 * wants newest-first, with the document's own body standing in when the
 * revision list has not loaded (or the server keeps none). All pure, so the
 * label — "Version 2 · handed in 10:42 · accepted" — has exactly one home.
 */
import type { DocumentRevision, IssueDocument } from "@todero/shared";

export type DeliverableVersion = {
  number: number;
  body: string;
  at: Date | string | null;
};

/** Newest first. Always at least one entry, so the tab is never blank. */
export function deliverableVersions(
  doc: Pick<IssueDocument, "body" | "latestRevisionNumber" | "updatedAt">,
  revisions: DocumentRevision[],
): DeliverableVersion[] {
  const fromRevisions = revisions
    .map((revision) => ({
      number: revision.revisionNumber,
      body: revision.body,
      at: revision.createdAt ?? null,
    }))
    .sort((left, right) => right.number - left.number);
  if (fromRevisions.length > 0) return fromRevisions;
  return [
    {
      number: doc.latestRevisionNumber || 1,
      body: doc.body,
      at: doc.updatedAt ?? null,
    },
  ];
}

/** "10:42" today, "11 Sep 10:42" any other day. Empty when there is no time. */
export function handedInAt(at: Date | string | null | undefined, now: Date = new Date()): string {
  if (!at) return "";
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  const time = when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();
  if (sameDay) return time;
  return `${when.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

/**
 * "Version 2 · handed in 10:42 · accepted". Only the newest version can be the
 * accepted one, and only once the task is done and nothing is still waiting on
 * the person.
 */
export function versionLabel(
  version: DeliverableVersion,
  state: { latest?: boolean; reviewPending?: boolean; accepted?: boolean },
  now: Date = new Date(),
): string {
  const parts = [`Version ${version.number}`];
  const time = handedInAt(version.at, now);
  if (time) parts.push(`handed in ${time}`);
  if (state.latest && state.accepted && !state.reviewPending) parts.push("accepted");
  return parts.join(" · ");
}

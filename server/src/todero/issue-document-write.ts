/**
 * Writing a task's document from a turn: Plan, Output, Next, the manager's
 * guidance. The document service refuses to update an existing document
 * without the revision the write builds on, which is right for two people
 * editing at once. A turn is not that: it always means "this is the newest
 * version". On the wave-7 live loop the reviewer sent a task back once, and
 * the worker's second hand-in failed with "Document update requires
 * baseRevisionId" — the whole hand-in was dropped and a handoff notice
 * followed. This reads the current revision first, so a second write lands
 * as revision two instead of failing.
 */
import type { Db } from "@todero/db";
import { documentService } from "../services/documents.js";

type Documents = ReturnType<typeof documentService>;
type UpsertIssueDocumentInput = Parameters<Documents["upsertIssueDocument"]>[0];

/** The write a turn makes: everything but the base revision, which is looked up here. */
export type IssueDocumentWrite = Omit<UpsertIssueDocumentInput, "baseRevisionId">;

/**
 * Create the document, or update it on top of whatever revision it has now.
 * Returns what the document service returns.
 */
export async function writeIssueDocumentOnLatest(db: Db, input: IssueDocumentWrite) {
  const documents = documentService(db);
  const existing = await documents.getIssueDocumentByKey(input.issueId, input.key).catch(() => null);
  return documents.upsertIssueDocument({
    ...input,
    baseRevisionId: existing?.latestRevisionId ?? null,
  });
}

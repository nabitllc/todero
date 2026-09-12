// Repro — wave 7, gauntlet item 0's promise: no handoff wake after a send-back.
//
// On the wave-7 live loop the reviewer sent a task back once. The worker's
// second hand-in then failed with "Document update requires baseRevisionId":
// its Output document already existed from the first hand-in, and the write
// did not say which revision it built on. The whole hand-in was dropped, the
// successful-run handoff fired, and the person got "Todero needs you to choose
// what happens next". Every task that goes round the reviewer once hit this.
//
// writeIssueDocumentOnLatest reads the current revision first, so a turn's
// write always lands as the next revision.
//
// docs/ai_context/gauntlet/repros/second-hand-in.gauntlet.ts points here; the
// gauntlet runs it as `repro_second_hand_in`. Fails on origin/main (the helper
// does not exist there, and the plain write it replaces throws), passes on
// fix/second-hand-in-keeps-its-document.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, documentRevisions, documents, issueDocuments, issues } from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { documentService } from "../services/documents.js";
import { writeIssueDocumentOnLatest } from "./issue-document-write.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue-document-write tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("a turn's second write of the same document", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-issue-document-write-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(documentRevisions);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedTask() {
    const companyId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Todero",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      identifier: "T-2",
      title: "One-page concept",
      description: "Hand in the one-page concept.",
      status: "in_progress",
      priority: "medium",
    });
    return { companyId, issueId };
  }

  const handIn = (issueId: string, body: string) => ({
    issueId,
    key: "output",
    title: "Output",
    format: "markdown" as const,
    body,
    changeSummary: "Handed in by the agent.",
    lockedDocumentStrategy: "conflict" as const,
  });

  it("lands as the next revision instead of failing", async () => {
    const { issueId } = await seedTask();

    await writeIssueDocumentOnLatest(db, handIn(issueId, "First draft."));
    await writeIssueDocumentOnLatest(db, handIn(issueId, "Second draft, after the reviewer's note."));

    const output = await documentService(db).getIssueDocumentByKey(issueId, "output");
    expect(output?.body).toBe("Second draft, after the reviewer's note.");
    expect(output?.latestRevisionNumber).toBe(2);
  });

  it("is what the plain write could not do", async () => {
    const { issueId } = await seedTask();
    const plain = documentService(db);

    await plain.upsertIssueDocument(handIn(issueId, "First draft."));
    await expect(plain.upsertIssueDocument(handIn(issueId, "Second draft."))).rejects.toThrow(/baseRevisionId/);
  });
});

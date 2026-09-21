// The work a task builds on, against a real database.
//
// The rules live in task-inputs.test.ts, which stands in for the database. The
// three things that only a database can answer are here: that the dependency is
// read in the right direction, that one organization cannot see another one's
// work, and that the document written on the task is the one a person opens.
//
// This is the part the reviewer of wave 2 could only read, not run.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  documentRevisions,
  documents,
  issueDocuments,
  issueRelations,
  issues,
} from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { writeIssueDocumentOnLatest } from "./issue-document-write.js";
import { syncTaskInputs, taskInputsDbDeps, TASK_INPUTS_DOCUMENT_KEY } from "./task-inputs.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping the embedded Postgres task-inputs tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("the work a task builds on, read from the database", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-task-inputs-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(documentRevisions);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Todero",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  /** One task, created at a time the test chooses so plan order is not a guess. */
  async function seedTask(companyId: string, identifier: string, title: string, minute: number) {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      identifier,
      title,
      description: `${title}.`,
      status: "todo",
      priority: "medium",
      createdAt: new Date(Date.UTC(2026, 8, 20, 12, minute)),
    });
    return issueId;
  }

  /** "earlier must finish before later starts", the way approval records it. */
  async function seedDependency(companyId: string, earlier: string, later: string) {
    await db.insert(issueRelations).values({
      companyId,
      issueId: earlier,
      relatedIssueId: later,
      type: "blocks",
    });
  }

  const handIn = (issueId: string, body: string) =>
    writeIssueDocumentOnLatest(db, {
      issueId,
      key: "output",
      title: "Output",
      format: "markdown" as const,
      body,
      changeSummary: "Handed in by the agent.",
    });

  it("reads the tasks that had to finish first, and not the ones before those", async () => {
    const companyId = await seedCompany();
    const topics = await seedTask(companyId, "T-2", "Pick the four topics", 0);
    const drafts = await seedTask(companyId, "T-3", "Write initial drafts", 1);
    const review = await seedTask(companyId, "T-4", "Review the drafts", 2);
    await seedDependency(companyId, topics, drafts);
    await seedDependency(companyId, drafts, review);
    const deps = taskInputsDbDeps(db, { companyId });

    // The reviewer waits on the drafts, and only on the drafts: the topics are
    // the drafts' own predecessor, two steps back.
    const before = await deps.listDirectPredecessors(review);
    expect(before.map((task) => task.identifier)).toEqual(["T-3"]);

    // And the first task of the plan waits on nobody. This is also what a
    // conversation task looks like: nothing blocks it, so it gathers nothing.
    expect(await deps.listDirectPredecessors(topics)).toEqual([]);
  });

  it("keeps two predecessors in the order the plan made them", async () => {
    const companyId = await seedCompany();
    const research = await seedTask(companyId, "T-2", "Research the audience", 0);
    const outline = await seedTask(companyId, "T-3", "Write the outline", 1);
    const write = await seedTask(companyId, "T-4", "Write the guides", 2);
    // Recorded in the opposite order to the one they were created in, so the
    // answer cannot come from the order the rows were inserted.
    await seedDependency(companyId, outline, write);
    await seedDependency(companyId, research, write);

    const before = await taskInputsDbDeps(db, { companyId }).listDirectPredecessors(write);
    expect(before.map((task) => task.identifier)).toEqual(["T-2", "T-3"]);
    expect(before.map((task) => task.title)).toEqual(["Research the audience", "Write the outline"]);
  });

  it("never reaches into another organization", async () => {
    const mine = await seedCompany();
    const theirs = await seedCompany();
    const myTask = await seedTask(mine, "T-2", "Write the guides", 0);
    const theirEarlier = await seedTask(theirs, "O-2", "Someone else's work", 0);
    const theirLater = await seedTask(theirs, "O-3", "Someone else's next step", 1);
    await seedDependency(theirs, theirEarlier, theirLater);

    // Asking my organization's question about their task answers nothing.
    expect(await taskInputsDbDeps(db, { companyId: mine }).listDirectPredecessors(theirLater)).toEqual([]);
    expect(await taskInputsDbDeps(db, { companyId: mine }).listDirectPredecessors(myTask)).toEqual([]);
    // Their own organization still sees it.
    const theirView = await taskInputsDbDeps(db, { companyId: theirs }).listDirectPredecessors(theirLater);
    expect(theirView.map((task) => task.identifier)).toEqual(["O-2"]);
  });

  it("puts the predecessor's hand-in on the task, where a person can open it", async () => {
    const companyId = await seedCompany();
    const drafts = await seedTask(companyId, "T-3", "Write initial drafts", 0);
    const review = await seedTask(companyId, "T-4", "Review the drafts", 1);
    await seedDependency(companyId, drafts, review);
    await handIn(drafts, "Guide 1 — Signing up: open the invite link.");
    const deps = taskInputsDbDeps(db, { companyId });

    const gathered = await syncTaskInputs(deps, review);
    expect(gathered.map((input) => input.identifier)).toEqual(["T-3"]);
    expect(gathered[0]!.body).toContain("Guide 1 — Signing up");

    const saved = await deps.readCurrentInputs(review);
    expect(saved).toContain("T-3 — Write initial drafts");
    expect(saved).toContain("Guide 1 — Signing up");
    expect(TASK_INPUTS_DOCUMENT_KEY).toBe("inputs");
  });

  it("stores one version per change, not one per wake", async () => {
    const companyId = await seedCompany();
    const drafts = await seedTask(companyId, "T-3", "Write initial drafts", 0);
    const review = await seedTask(companyId, "T-4", "Review the drafts", 1);
    await seedDependency(companyId, drafts, review);
    await handIn(drafts, "The first, thin draft.");
    const deps = taskInputsDbDeps(db, { companyId });

    await syncTaskInputs(deps, review);
    await syncTaskInputs(deps, review);
    await syncTaskInputs(deps, review);
    expect(await db.select().from(documentRevisions)).toHaveLength(2); // the hand-in, and this

    // Sent back and redone: the next wake reads the new version.
    await handIn(drafts, "The rewritten draft, with the four guides.");
    const second = await syncTaskInputs(deps, review);
    expect(second[0]!.body).toBe("The rewritten draft, with the four guides.");
    expect(await deps.readCurrentInputs(review)).toContain("The rewritten draft, with the four guides.");
  });
});

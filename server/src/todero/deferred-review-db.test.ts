// The reviews a hold deferred, against a real database.
//
// deferred-review.test.ts stands in for the database and tests the rules on
// their own. Everything here needs a database to be true at all: which stopped
// tasks are picked up (the rescue rule is the part wave 18 depended on, and it
// is all SQL), that a second pass cannot review the same hand-in, that a task
// nobody can review is left alone afterwards instead of being churned every
// time the organization starts, and what each of the reviewer's four answers
// actually does to the task.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agents,
  authUsers,
  companies,
  createDb,
  issueComments,
  issues,
} from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import {
  CONVERSATION_OUTPUT_DOCUMENT_KEY,
  descriptionForDeferredReview,
  descriptionWithReviewMarker,
  hasDeferredReviewMarker,
  REVIEW_PENDING_MARKER,
} from "./conversation-outcome.js";
import { descriptionWithWaitingMarker } from "./conversation-thread.js";
import { writeIssueDocumentOnLatest } from "./issue-document-write.js";
import { JUDGE_AGENT_METADATA_KEY, JUDGE_AGENT_METADATA_VERSION } from "./judge-agent.js";
import { reviewDeferredHandIns, type DeferredReviewWakeup } from "./deferred-review.js";
import { loadDeferredHandIns, NO_REVIEWER_NOTE_OPENING } from "./deferred-review-find.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping the embedded Postgres deferred-review tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const DELIVERABLE = "Here is the welcome guide.\n\n1. Open the invite link.\n2. Pick a password.";

describeEmbeddedPostgres("the reviews a hold deferred, against a real database", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let models: Server;
  let reviewerUrl = "";
  /** Every time the reviewer's model was asked for an answer. */
  let timesAsked = 0;
  /** What the reviewer's model says next. */
  let verdictText = "Verdict: pass\nIt does what the task asked.";
  /** While set, the model does not answer until this is resolved. */
  let holdTheModel: { promise: Promise<void>; release: () => void } | null = null;
  /** Every agent the code asked to be brought back to a task. */
  let woken: string[] = [];

  const wakeup: DeferredReviewWakeup = async (agentId) => {
    woken.push(agentId);
    return null;
  };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-deferred-review-db-");
    db = createDb(tempDb.connectionString);
    models = createServer((req, res) => {
      timesAsked += 1;
      req.resume();
      req.on("end", () => {
        void Promise.resolve(holdTheModel?.promise).then(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: verdictText } }] }));
        });
      });
    });
    await new Promise<void>((resolve) => models.listen(0, "127.0.0.1", resolve));
    reviewerUrl = `http://127.0.0.1:${(models.address() as AddressInfo).port}/v1/chat/completions`;

    const now = new Date();
    await db.insert(authUsers).values({
      id: "responsible-user",
      name: "Responsible User",
      email: "responsible-user@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
  }, 30_000);

  beforeEach(() => {
    timesAsked = 0;
    woken = [];
    verdictText = "Verdict: pass\nIt does what the task asked.";
    holdTheModel = null;
  });

  // Nothing is deleted between tests: every test seeds its own organization and
  // every query here is scoped to one organization or one task, so leftovers
  // from an earlier test cannot be seen by a later one.

  afterAll(async () => {
    await new Promise<void>((resolve) => models.close(() => resolve()));
    await tempDb?.cleanup();
  });

  type Seeded = {
    companyId: string;
    workerId: string;
    reviewerId: string;
    parentId: string;
    taskId: string;
  };

  async function seed(options: {
    /** "active" unless the test is about an organization put back on hold. */
    status?: string;
    /** false leaves the reviewer with nothing to think with. */
    reviewerHasAModel?: boolean;
    autoAcceptWhenJudgePasses?: boolean;
    /** The task's own text: marked as still owed a review unless the test says otherwise. */
    description?: string;
    taskStatus?: string;
    /** false leaves the task with nothing handed in. */
    handedIn?: boolean;
  } = {}): Promise<Seeded> {
    const companyId = randomUUID();
    const workerId = randomUUID();
    const reviewerId = randomUUID();
    const parentId = randomUUID();
    const taskId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Zz Gauntlet Org",
      issuePrefix,
      status: options.status ?? "active",
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
      interactionResolverGovernance: {
        autoAcceptWhenJudgePasses: options.autoAcceptWhenJudgePasses ?? true,
      },
    });
    await db.insert(agents).values([
      {
        id: workerId,
        companyId,
        name: "Nova",
        role: "general",
        status: "active",
        adapterType: "http",
        adapterConfig: { url: reviewerUrl, method: "POST", model: "qwen2.5-coder:14b" },
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: reviewerId,
        companyId,
        name: "Nova's reviewer",
        role: "reviewer",
        status: "active",
        adapterType: "http",
        adapterConfig: options.reviewerHasAModel === false
          ? {}
          : { url: reviewerUrl, method: "POST", model: "qwen2.5-coder:14b" },
        runtimeConfig: {},
        permissions: {},
        metadata: { [JUDGE_AGENT_METADATA_KEY]: { version: JUDGE_AGENT_METADATA_VERSION, forAgentId: workerId } },
      },
    ]);
    await db.insert(issues).values([
      {
        id: parentId,
        companyId,
        title: "Get new people started",
        description: "The conversation the plan came from.",
        status: "blocked",
        priority: "medium",
        assigneeAgentId: workerId,
        issueNumber: 1,
        identifier: `${issuePrefix}-1`,
      },
      {
        id: taskId,
        companyId,
        parentId,
        title: "Write the welcome guide",
        description: options.description ?? descriptionForDeferredReview("Write the welcome guide."),
        status: options.taskStatus ?? "blocked",
        priority: "medium",
        assigneeAgentId: workerId,
        issueNumber: 2,
        identifier: `${issuePrefix}-2`,
      },
    ]);
    if (options.handedIn !== false) {
      await writeIssueDocumentOnLatest(db, {
        issueId: taskId,
        key: CONVERSATION_OUTPUT_DOCUMENT_KEY,
        title: "Output",
        format: "markdown",
        body: DELIVERABLE,
        changeSummary: "Handed in by the agent.",
        createdByAgentId: workerId,
      });
    }
    return { companyId, workerId, reviewerId, parentId, taskId };
  }

  /** A hand-in from before the note existed: waiting on the person, nothing said since. */
  const unmarkedHandIn = () =>
    descriptionWithReviewMarker(descriptionWithWaitingMarker("Write the welcome guide.", true), true);

  function readTask(taskId: string) {
    return db
      .select({ status: issues.status, description: issues.description, updatedAt: issues.updatedAt })
      .from(issues)
      .where(eq(issues.id, taskId))
      .then((rows) => rows[0]!);
  }

  function commentsOn(taskId: string) {
    return db
      .select({ body: issueComments.body, authorAgentId: issueComments.authorAgentId })
      .from(issueComments)
      .where(eq(issueComments.issueId, taskId))
      .then((rows) => rows);
  }

  const review = (companyId: string) => reviewDeferredHandIns(db, { enqueueWakeup: wakeup, log: () => {} }, { companyId });

  describe("which stopped tasks are still owed a review", () => {
    it("finds the one that says a reviewer still owes it an answer", async () => {
      const { companyId, taskId } = await seed();
      const found = await loadDeferredHandIns(db, companyId);
      expect(found.map((task) => task.id)).toEqual([taskId]);
    });

    it("finds one handed in before the note existed that no reviewer ever answered", async () => {
      const { companyId, taskId } = await seed({ description: unmarkedHandIn() });
      const found = await loadDeferredHandIns(db, companyId);
      expect(found.map((task) => task.id)).toEqual([taskId]);
      expect(found[0]!.deliverable).toContain("Here is the welcome guide.");
      expect(found[0]!.handedInAt).toBeInstanceOf(Date);
    });

    it("leaves one whose reviewer already spoke after the hand-in", async () => {
      const { companyId, taskId, reviewerId } = await seed({ description: unmarkedHandIn() });
      await issueService(db).addComment(
        taskId,
        "I read it and it does what the task asked.",
        { agentId: reviewerId },
        { createdAt: new Date(Date.now() + 60_000) },
      );
      expect(await loadDeferredHandIns(db, companyId)).toEqual([]);
    });

    it("leaves one Todero has already said nobody could look at", async () => {
      const { companyId, taskId } = await seed({ description: unmarkedHandIn() });
      await issueService(db).addComment(
        taskId,
        `${NO_REVIEWER_NOTE_OPENING}: this team has nobody who reviews work. It is waiting for you.`,
        {},
        { authorType: "system", createdAt: new Date(Date.now() + 60_000) },
      );
      expect(await loadDeferredHandIns(db, companyId)).toEqual([]);
    });

    it("leaves one that is already finished", async () => {
      const { companyId } = await seed({ taskStatus: "done" });
      expect(await loadDeferredHandIns(db, companyId)).toEqual([]);
    });

    it("reads only the organization it was asked about", async () => {
      const mine = await seed();
      const theirs = await seed();
      const found = await loadDeferredHandIns(db, mine.companyId);
      expect(found.map((task) => task.id)).toEqual([mine.taskId]);
      expect(found.map((task) => task.id)).not.toContain(theirs.taskId);
    });
  });

  describe("an organization put back on hold part-way through", () => {
    it("asks no model at all, and leaves the hand-in still owed a review", async () => {
      const { companyId, taskId } = await seed({ status: "paused" });

      const tally = await review(companyId);

      expect(timesAsked).toBe(0);
      expect(tally.reviewed).toBe(0);
      expect(tally.stopped).toBe(true);
      expect(await commentsOn(taskId)).toEqual([]);
      const task = await readTask(taskId);
      expect(hasDeferredReviewMarker(task.description)).toBe(true);
      expect(task.status).toBe("blocked");
    });
  });

  describe("two passes over the same organization at once", () => {
    it("asks the reviewer once and leaves one answer on the task", async () => {
      const { companyId, taskId, reviewerId } = await seed();
      let release = () => {};
      holdTheModel = {
        promise: new Promise<void>((resolve) => {
          release = resolve;
        }),
        release: () => release(),
      };

      const first = review(companyId);
      // Give the first pass time to take the task and reach the model.
      await expect.poll(() => timesAsked, { timeout: 10_000, interval: 25 }).toBe(1);
      const second = await review(companyId);
      expect(second.alreadyRunning).toBe(true);
      expect(second.reviewed).toBe(0);

      holdTheModel.release();
      const firstTally = await first;
      expect(firstTally.reviewed).toBe(1);
      expect(timesAsked).toBe(1);

      const answers = (await commentsOn(taskId)).filter((row) => row.authorAgentId === reviewerId);
      expect(answers).toHaveLength(1);
    }, 30_000);
  });

  describe("a hand-in nobody can review", () => {
    // The rescue rule is the one that re-fired: it picks a task up because the
    // reviewer never spoke, and a reviewer that cannot answer never will.
    it("is written about once and then left alone", async () => {
      const { companyId, taskId } = await seed({
        reviewerHasAModel: false,
        description: unmarkedHandIn(),
      });

      await review(companyId);
      const afterFirst = await readTask(taskId);
      await review(companyId);
      const afterSecond = await readTask(taskId);
      await review(companyId);
      const afterThird = await readTask(taskId);

      expect(timesAsked).toBe(0);
      expect(afterSecond.updatedAt.getTime()).toBe(afterFirst.updatedAt.getTime());
      expect(afterThird.updatedAt.getTime()).toBe(afterFirst.updatedAt.getTime());

      const notes = (await commentsOn(taskId)).filter((row) => row.body.startsWith(NO_REVIEWER_NOTE_OPENING));
      expect(notes).toHaveLength(1);
      expect(notes[0]!.body).toContain("the reviewer has no model to think with");
      expect(notes[0]!.body).toContain("waiting for you");
      // And it is not offered up again the moment the organization starts.
      expect(await loadDeferredHandIns(db, companyId)).toEqual([]);
    }, 30_000);

    it("stops saying a reviewer still owes it an answer", async () => {
      const { companyId, taskId } = await seed({ reviewerHasAModel: false });
      await review(companyId);
      const task = await readTask(taskId);
      expect(hasDeferredReviewMarker(task.description)).toBe(false);
      expect(task.status).toBe("blocked");
    });
  });

  describe("what each of the reviewer's answers does to the task", () => {
    it("leaves a pass the organization does not accept on its own with the person", async () => {
      const { companyId, taskId, reviewerId } = await seed({ autoAcceptWhenJudgePasses: false });

      const tally = await review(companyId);

      expect(tally.reviewed).toBe(1);
      expect(timesAsked).toBe(1);
      const task = await readTask(taskId);
      expect(task.status).toBe("blocked");
      expect(hasDeferredReviewMarker(task.description)).toBe(false);
      expect(task.description ?? "").toContain(REVIEW_PENDING_MARKER);
      expect((await commentsOn(taskId)).filter((row) => row.authorAgentId === reviewerId)).toHaveLength(1);
    }, 30_000);

    it("leaves nothing owed on a task it rescued rather than one that was marked", async () => {
      // Taking an unmarked task marks it, so that a machine that stops mid-way
      // leaves the work findable. Once the reviewer has answered, that mark has
      // to be gone again or the task comes round on every start.
      const { companyId, taskId } = await seed({
        autoAcceptWhenJudgePasses: false,
        description: unmarkedHandIn(),
      });

      await review(companyId);

      const task = await readTask(taskId);
      expect(hasDeferredReviewMarker(task.description)).toBe(false);
      expect(task.description ?? "").toContain(REVIEW_PENDING_MARKER);
      expect(await loadDeferredHandIns(db, companyId)).toEqual([]);
    }, 30_000);

    it("sends a fail back to the worker and brings the worker to it", async () => {
      verdictText = "Verdict: fail\nThe third step is missing.";
      const { companyId, taskId, workerId } = await seed();

      const tally = await review(companyId);

      expect(tally.reviewed).toBe(1);
      const task = await readTask(taskId);
      expect(task.status).toBe("todo");
      expect(hasDeferredReviewMarker(task.description)).toBe(false);
      expect(task.description ?? "").not.toContain(REVIEW_PENDING_MARKER);
      expect(woken).toContain(workerId);
    }, 30_000);

    it("closes a pass the organization accepts on its own", async () => {
      const { companyId, taskId } = await seed();

      const tally = await review(companyId);

      expect(tally.reviewed).toBe(1);
      const task = await readTask(taskId);
      expect(task.status).toBe("done");
      expect(hasDeferredReviewMarker(task.description)).toBe(false);
      expect(task.description ?? "").not.toContain(REVIEW_PENDING_MARKER);
    }, 30_000);

    it("tells the person when the reviewer gives no answer, and asks no model twice", async () => {
      verdictText = "I am not sure what to say about this.";
      const { companyId, taskId } = await seed();

      const tally = await review(companyId);

      expect(timesAsked).toBe(1);
      expect(tally.reviewed).toBe(1);
      const task = await readTask(taskId);
      expect(hasDeferredReviewMarker(task.description)).toBe(false);
      const notes = (await commentsOn(taskId)).filter((row) => row.body.startsWith(NO_REVIEWER_NOTE_OPENING));
      expect(notes).toHaveLength(1);
      expect(notes[0]!.body).toContain("the reviewer gave no answer");

      // A second start must not ask the model about the same hand-in again.
      await review(companyId);
      expect(timesAsked).toBe(1);
    }, 30_000);
  });
});

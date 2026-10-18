// The fresh review a parked refusal gets on Play, against a real database.
//
// refused-review-refresh.test.ts stands the database in and tests the rule on
// its own. Everything here needs a database to be true at all: that a task
// parked the way wave 21 parked one is found, that the reviewer is asked again
// under the brief it has today, that what it decides is written onto the task,
// and that a second start leaves the task alone.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, authUsers, companies, createDb, issueComments, issues } from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import {
  CONVERSATION_OUTPUT_DOCUMENT_KEY,
  descriptionWithReviewMarker,
  hasRefreshedReviewMarker,
} from "./conversation-outcome.js";
import { descriptionWithWaitingMarker } from "./conversation-thread.js";
import { writeIssueDocumentOnLatest } from "./issue-document-write.js";
import { JUDGE_AGENT_METADATA_KEY, JUDGE_AGENT_METADATA_VERSION } from "./judge-agent.js";
import {
  instructionForConversationWake,
  JUDGE_REVISION_WAKE_REASON,
} from "./judge-apply.js";
import { JUDGE_OVER_TO_YOU_OPENING, JUDGE_SENT_BACK_OPENING, readJudgeFailRounds } from "./judge.js";
import { TEXT_ONLY_WORKER_NOTE } from "./judge-text-only-worker.js";
import type { DeferredReviewWakeup } from "./deferred-review.js";
import { loadRefusedHandInsToRefresh, refreshRefusedHandIns } from "./refused-review-refresh.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping the embedded Postgres refused-review tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/** The guides wave 21 handed in, shortened. */
const DELIVERABLE = [
  "1. Sansevieria (Snake Plant) — low to bright indirect light, water every two to four weeks.",
  "2. ZZ Plant — very low light, water every four to six weeks.",
].join("\n");

/** The refusal wave 21's reviewer left on the task, word for word. */
const THE_REFUSAL = [
  "I reviewed this twice and it is still not there. Over to you.",
  "",
  "Checked 2 things. 1 met, 1 not met.",
  "",
  "- met — All four drafts have been reviewed and refined to read well.",
  "- not met — The hand-in is The refined guides, ready for publication.",
  "",
  "The refined guides are provided in plain text format, but they are not ready for publication as"
    + " they lack any visual formatting or layout.",
].join("\n");

describeEmbeddedPostgres("the fresh review a parked refusal gets, against a real database", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let models: Server;
  let modelUrl = "";
  /** Every prompt the reviewer's model was sent. */
  let asked: string[] = [];
  /** What the reviewer's model says next. */
  let verdictText = "1: met\n2: met\nVerdict: pass\nThe guides read well and cover each plant.";

  /** Every agent this pass asked Todero to bring back, and with what. */
  let wakes: Array<{ agentId: string; contextSnapshot: unknown }> = [];

  const wakeup: DeferredReviewWakeup = async (agentId, wake) => {
    wakes.push({ agentId, contextSnapshot: wake.contextSnapshot });
    return null;
  };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-refused-review-db-");
    db = createDb(tempDb.connectionString);
    models = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        asked.push(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: verdictText } }] }));
      });
    });
    await new Promise<void>((resolve) => models.listen(0, "127.0.0.1", resolve));
    modelUrl = `http://127.0.0.1:${(models.address() as AddressInfo).port}/v1/chat/completions`;

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
    asked = [];
    wakes = [];
    verdictText = "1: met\n2: met\nVerdict: pass\nThe guides read well and cover each plant.";
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => models.close(() => resolve()));
    await tempDb?.cleanup();
  });

  type Seeded = { companyId: string; workerId: string; reviewerId: string; taskId: string };

  /** A task parked the way wave 21 parked one: real work in, refused twice. */
  async function seed(options: { autoAcceptWhenJudgePasses?: boolean; refused?: boolean } = {}): Promise<Seeded> {
    const companyId = randomUUID();
    const workerId = randomUUID();
    const reviewerId = randomUUID();
    const parentId = randomUUID();
    const taskId = randomUUID();
    const issuePrefix = `R${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Zz Gauntlet Org",
      issuePrefix,
      status: "active",
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
        adapterConfig: { url: modelUrl, method: "POST", model: "qwen2.5-coder:14b" },
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
        adapterConfig: { url: modelUrl, method: "POST", model: "qwen2.5-coder:14b" },
        runtimeConfig: {},
        permissions: {},
        metadata: { [JUDGE_AGENT_METADATA_KEY]: { version: JUDGE_AGENT_METADATA_VERSION, forAgentId: workerId } },
      },
    ]);
    await db.insert(issues).values([
      {
        id: parentId,
        companyId,
        title: "Publish a one-page guide to each of four houseplants",
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
        title: "Review and refine the draft guides",
        // Two refusals already counted against it: at the reviewer's cap.
        description: descriptionWithReviewMarker(
          descriptionWithWaitingMarker("<!-- todero-judge-rounds: 2 -->\nReview and refine the draft guides.", true),
          true,
        ),
        status: "blocked",
        priority: "medium",
        assigneeAgentId: workerId,
        issueNumber: 2,
        identifier: `${issuePrefix}-2`,
      },
    ]);
    await writeIssueDocumentOnLatest(db, {
      issueId: taskId,
      key: CONVERSATION_OUTPUT_DOCUMENT_KEY,
      title: "Output",
      format: "markdown",
      body: DELIVERABLE,
      changeSummary: "Handed in by the agent.",
      createdByAgentId: workerId,
    });
    if (options.refused !== false) {
      await issueService(db).addComment(taskId, THE_REFUSAL, { agentId: reviewerId });
    }
    return { companyId, workerId, reviewerId, taskId };
  }

  function readTask(taskId: string) {
    return db
      .select({ status: issues.status, description: issues.description })
      .from(issues)
      .where(eq(issues.id, taskId))
      .then((rows) => rows[0]!);
  }

  function commentsOn(taskId: string) {
    return db
      .select({ body: issueComments.body })
      .from(issueComments)
      .where(eq(issueComments.issueId, taskId))
      .then((rows) => rows.map((row) => row.body));
  }

  const refresh = (companyId: string) =>
    refreshRefusedHandIns(db, { enqueueWakeup: wakeup, log: () => {} }, { companyId });

  it("finds the task the reviewer refused and left with the person", async () => {
    const { companyId, taskId } = await seed();
    const found = await loadRefusedHandInsToRefresh(db, companyId);
    expect(found.map((task) => task.id)).toEqual([taskId]);
    expect(found[0]!.deliverable).toContain("Snake Plant");
    expect(found[0]!.reviewerSentItBack).toBe(true);
  });

  it("leaves it alone once a person has answered", async () => {
    const { companyId, taskId } = await seed();
    await issueService(db).addComment(
      taskId,
      "Do them as a slide deck instead.",
      { userId: "responsible-user" },
      { authorType: "user" },
    );
    expect(await loadRefusedHandInsToRefresh(db, companyId)).toEqual([]);
  });

  it("leaves one no reviewer ever refused", async () => {
    const { companyId } = await seed({ refused: false });
    expect(await loadRefusedHandInsToRefresh(db, companyId)).toEqual([]);
  });

  it("asks the reviewer again under the brief it has today, and closes the task on a pass", async () => {
    const { companyId, taskId } = await seed();
    const tally = await refresh(companyId);
    expect(tally.reviewed).toBe(1);
    expect(tally.failed).toBe(0);
    expect(asked).toHaveLength(1);
    // The worker on this task can only write, and the brief now says so.
    expect(asked[0]).toContain(TEXT_ONLY_WORKER_NOTE.slice(0, 60));
    expect((await readTask(taskId)).status).toBe("done");
    expect(await commentsOn(taskId)).toHaveLength(2);
  });

  it("sends a refusal back to the worker for another try, instead of to the person", async () => {
    const { companyId, taskId, workerId } = await seed({ autoAcceptWhenJudgePasses: false });
    verdictText = [
      "1: not met",
      "2: not met",
      "Verdict: fail",
      "It does not include the actual refined guides. Instead, it provides a plan for refining the guides.",
    ].join("\n");

    const tally = await refresh(companyId);
    expect(tally.reviewed).toBe(1);
    expect(tally.failed).toBe(0);

    // The task is the worker's again, and this refusal is its first.
    const after = await readTask(taskId);
    expect(after.status).toBe("todo");
    expect(readJudgeFailRounds(after.description)).toBe(1);

    // The reviewer sent it back rather than handing it to the person.
    const said = await commentsOn(taskId);
    expect(said[said.length - 1]).toContain(JUDGE_SENT_BACK_OPENING);
    expect(said[said.length - 1]).not.toContain(JUDGE_OVER_TO_YOU_OPENING);

    // The worker is brought back, and its turn says what to fix.
    expect(wakes.map((wake) => wake.agentId)).toEqual([workerId]);
    const instruction = instructionForConversationWake(JUDGE_REVISION_WAKE_REASON, wakes[0]!.contextSnapshot);
    expect(instruction).toContain("hand in the work itself, complete, in this reply");
    expect(instruction).toContain("does not include the actual refined guides");

    // Starting the organization again leaves it alone: it is the worker's turn.
    const again = await refresh(companyId);
    expect(again.reviewed).toBe(0);
    expect(asked).toHaveLength(1);
  });

  it("gives each refusal one fresh look and no more", async () => {
    const { companyId, taskId } = await seed({ autoAcceptWhenJudgePasses: false });
    await refresh(companyId);
    const afterOnce = await readTask(taskId);
    expect(afterOnce.status).toBe("blocked");
    expect(hasRefreshedReviewMarker(afterOnce.description)).toBe(true);
    expect(asked).toHaveLength(1);

    const again = await refresh(companyId);
    expect(again.reviewed).toBe(0);
    expect(asked).toHaveLength(1);
  });
});

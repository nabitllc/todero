// Repro — waves 16, 17 and 18 of the improvement loop: a hand-in that arrived
// while the organization was on hold was never reviewed, and nothing ever came
// back for it.
//
// Seen three times. Both live harnesses hold the organization for ninety
// seconds the moment the first child task starts, so the first hand-in lands
// inside the hold. Wave 17's fresh organization is the clearest: ZZGAAAAA-2
// handed in at 01:19:07, the run log said "No reviewer looked at this hand-in:
// the organization is paused", and that was the end of it. Tasks 3 to 7 waited
// on it for thirty-five minutes; nothing was done.
//
// The hold itself is right — nothing may talk to a model during one. What was
// missing is the way back: the task now remembers it is still owed a review,
// and starting the organization again runs the reviews the hold deferred.
//
// This drives the whole path against a real database: a hand-in skipped for a
// pause exactly the way the heartbeat skips it, then the organization opened
// again, then the reviewer's verdict and the closed task.
//
// Fails on origin/main (nothing ever reviews it; the task stays blocked and
// the reviewer never speaks). Run with:
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/deferred-review.gauntlet.ts
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, createDb, issueComments, issues } from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "../helpers/drain-heartbeat-runs.js";
import { companyService } from "../../services/companies.js";
import { issueService } from "../../services/issues.js";
import { heartbeatService } from "../../services/heartbeat.js";
import {
  CONVERSATION_OUTPUT_DOCUMENT_KEY,
  hasDeferredReviewMarker,
  REVIEW_PENDING_MARKER,
} from "../../todero/conversation-outcome.js";
import { writeIssueDocumentOnLatest } from "../../todero/issue-document-write.js";
import { applyJudgeReview } from "../../todero/judge-apply.js";
import { JUDGE_AGENT_METADATA_KEY, JUDGE_AGENT_METADATA_VERSION } from "../../todero/judge-agent.js";
import { reviewConversationHandIn } from "../../todero/judge-review.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

/** What the worker handed in, shortened from the wave-17 run. */
const DELIVERABLE =
  "Here is the welcome guide.\n\n1. Open the invite link.\n2. Pick a password.\n3. Confirm the email.";

describeEmbeddedPostgres("a hand-in nobody could review while the organization was on hold", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let models: Server;
  let reviewerUrl = "";
  let workerUrl = "";
  /** Every time the reviewer was asked for a verdict. */
  let timesAsked = 0;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-deferred-review-");
    db = createDb(tempDb.connectionString);
    // Building the heartbeat is what puts the real runner behind the resume
    // paths, exactly as the server does at startup.
    heartbeat = heartbeatService(db);

    // One stand-in model on two paths, so the reviewer's calls can be counted
    // apart from any turn the closed task sets off afterwards.
    models = createServer((req, res) => {
      const asReviewer = (req.url ?? "").startsWith("/review");
      if (asReviewer) timesAsked += 1;
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                content: asReviewer ? "Verdict: pass\nIt does what the task asked." : "Nothing further.",
              },
            }],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => models.listen(0, "127.0.0.1", resolve));
    const port = (models.address() as AddressInfo).port;
    reviewerUrl = `http://127.0.0.1:${port}/review/v1/chat/completions`;
    workerUrl = `http://127.0.0.1:${port}/worker/v1/chat/completions`;

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

  afterAll(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    await new Promise<void>((resolve) => models.close(() => resolve()));
    await tempDb?.cleanup();
  });

  async function seedOrganizationOnHold() {
    const companyId = randomUUID();
    const workerId = randomUUID();
    const reviewerId = randomUUID();
    const parentId = randomUUID();
    const childId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Zz Gauntlet Org",
      issuePrefix,
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date(),
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
      // The organization accepts a pass, so a review that passes closes the
      // task and lets whatever waits on it start.
      interactionResolverGovernance: { autoAcceptWhenJudgePasses: true },
    });
    await db.insert(agents).values([
      {
        id: workerId,
        companyId,
        name: "Nova",
        role: "general",
        status: "active",
        adapterType: "http",
        adapterConfig: { url: workerUrl, method: "POST", model: "qwen2.5-coder:14b" },
        runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
        permissions: {},
      },
      {
        id: reviewerId,
        companyId,
        name: "Nova's reviewer",
        role: "reviewer",
        status: "active",
        adapterType: "http",
        adapterConfig: { url: reviewerUrl, method: "POST", model: "qwen2.5-coder:14b" },
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
        id: childId,
        companyId,
        parentId,
        title: "Write the welcome guide",
        description: "Hand in: the welcome guide.",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: workerId,
        issueNumber: 2,
        identifier: `${issuePrefix}-2`,
      },
    ]);
    return { companyId, workerId, reviewerId, childId };
  }

  /** The hand-in, made the way the heartbeat makes it, with the hold in force. */
  async function handInDuringTheHold(input: { workerId: string; childId: string }) {
    const issuesSvc = issueService(db);
    await writeIssueDocumentOnLatest(db, {
      issueId: input.childId,
      key: CONVERSATION_OUTPUT_DOCUMENT_KEY,
      title: "Output",
      format: "markdown",
      body: DELIVERABLE,
      changeSummary: "Handed in by the agent.",
      createdByAgentId: input.workerId,
    });
    const issue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, input.childId))
      .then((rows) => rows[0]!);
    await issuesSvc.update(input.childId, {
      status: "blocked",
      description: `<!-- todero-blocked-by: waiting-on-you -->\n${REVIEW_PENDING_MARKER}\n${issue.description ?? ""}`,
      actorAgentId: input.workerId,
    });

    const review = await reviewConversationHandIn(db, {
      issue: {
        id: issue.id,
        companyId: issue.companyId,
        title: issue.title,
        description: issue.description,
        parentId: issue.parentId,
      },
      deliverable: DELIVERABLE,
      leadAgentId: input.workerId,
      companyStatus: "paused",
      autoAcceptWhenJudgePasses: true,
    });
    expect(review.skipped).toBe("paused");

    return applyJudgeReview(
      {
        addComment: (id, body, agentId) => issuesSvc.addComment(id, body, { agentId }),
        updateIssue: (id, patch) => issuesSvc.update(id, { ...patch, actorAgentId: input.workerId }),
        wakeAgent: async () => null,
        log: () => {},
      },
      {
        issue: { id: issue.id, identifier: issue.identifier, title: issue.title, description: issue.description },
        assigneeAgentId: input.workerId,
        review,
      },
    );
  }

  function readTask(childId: string) {
    return db
      .select({ status: issues.status, description: issues.description })
      .from(issues)
      .where(eq(issues.id, childId))
      .then((rows) => rows[0]!);
  }

  it("is reviewed when the organization starts again", async () => {
    const { companyId, workerId, reviewerId, childId } = await seedOrganizationOnHold();
    const applied = await handInDuringTheHold({ workerId, childId });

    // During the hold: nothing talked to a model, and the task says a reviewer
    // still owes it an answer.
    expect(applied).toBe("none");
    expect(timesAsked).toBe(0);
    const held = await readTask(childId);
    expect(held.status).toBe("blocked");
    expect(hasDeferredReviewMarker(held.description)).toBe(true);
    expect(held.description ?? "").toContain(REVIEW_PENDING_MARKER);

    // Play. On main this is where the task's life ended.
    await companyService(db).update(companyId, { status: "active" });

    await expect
      .poll(
        () =>
          db
            .select({ id: issueComments.id })
            .from(issueComments)
            .where(eq(issueComments.authorAgentId, reviewerId))
            .then((rows) => rows.length),
        { timeout: 20_000, interval: 50 },
      )
      .toBe(1);

    // The reviewer passed it, the organization accepts a pass, so the task is
    // closed and nothing is left saying it is owed anything.
    await expect.poll(() => readTask(childId).then((row) => row.status), { timeout: 20_000, interval: 50 })
      .toBe("done");
    const after = await readTask(childId);
    expect(hasDeferredReviewMarker(after.description)).toBe(false);
    expect(after.description ?? "").not.toContain(REVIEW_PENDING_MARKER);
    expect(timesAsked).toBe(1);

    // And it is never reviewed twice for the one hand-in.
    await companyService(db).update(companyId, { status: "paused" });
    await companyService(db).update(companyId, { status: "active" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(timesAsked).toBe(1);
  }, 60_000);
});

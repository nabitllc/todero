// Repro — wave 3, gauntlet item 0: the reviewer's thinking time derailed the loop.
//
// On the wave-3 live loop every child task was handed in, reviewed and passed,
// and every one of them still collected a "continuation" turn, a "choose what
// happens next" wake and two notices. The turn that handed the work in was
// stamped finished before the reviewer was asked; the reviewer is a model on
// this machine and takes fifteen seconds and more; the recovery sweep runs
// every thirty seconds and, seeing a finished turn on a task still
// `in_progress`, started a continuation for it.
//
// This file lives beside the server tests because it needs the server's own
// packages (@todero/db); docs/ai_context/gauntlet/repros/review-window.gauntlet.ts
// is the gauntlet's pointer to it.
//
// The fix (server/src/services/heartbeat.ts, the hand-in block) writes the
// hand-in — blocked, in review — before the reviewer is asked, so the task
// already reads "in review" while the reviewer thinks.
//
// Fails on origin/main (the reviewer is asked while the task is still
// `in_progress`), passes on fix/local-model-slow-turns. Run with:
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/review-window.gauntlet.ts
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
import {
  getServerAdapter,
  registerServerAdapter,
  type ServerAdapterModule,
} from "../../adapters/index.js";
import { heartbeatService } from "../../services/heartbeat.js";
import { REVIEW_PENDING_MARKER } from "../../todero/conversation-outcome.js";
import { JUDGE_AGENT_METADATA_KEY, JUDGE_AGENT_METADATA_VERSION } from "../../todero/judge-agent.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

/** What the worker handed in on the wave-3 loop, shortened. */
const DELIVERABLE =
  "Here is the one-page concept document.\n\n**Title: Tampa Strangers for Dinner**\n\nA platform that seats strangers together every Wednesday and Saturday.";

/** How long the stand-in reviewer thinks; long enough to matter, short enough for a test. */
const REVIEWER_THINKING_MS = 300;

describeEmbeddedPostgres("a hand-in while the reviewer thinks", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let realHttpAdapter: ServerAdapterModule | null = null;
  let reviewer: Server;
  let reviewerUrl = "";
  /** What the task looked like each time the reviewer was asked. */
  const seenByReviewer: Array<{ status: string; description: string }> = [];
  let childIssueId = "";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-review-window-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);

    // The worker: the same http adapter agents really use, answering the way
    // the model did on the loop — the deliverable, and "done".
    realHttpAdapter = getServerAdapter("http");
    registerServerAdapter({
      ...realHttpAdapter,
      execute: async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
        summary: DELIVERABLE,
        resultJson: { summary: DELIVERABLE, toderoDisposition: "done" },
      }),
    });

    // The reviewer: a real loopback chat endpoint that looks at the task before
    // it answers, the way a person would see it on the screen at that moment.
    reviewer = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        void db
          .select({ status: issues.status, description: issues.description })
          .from(issues)
          .where(eq(issues.id, childIssueId))
          .then((rows) => {
            seenByReviewer.push({ status: rows[0]?.status ?? "?", description: rows[0]?.description ?? "" });
            setTimeout(() => {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(
                JSON.stringify({
                  choices: [{ message: { role: "assistant", content: "Verdict: pass\nIt does what the task asked." } }],
                }),
              );
            }, REVIEWER_THINKING_MS);
          });
      });
    });
    await new Promise<void>((resolve) => reviewer.listen(0, "127.0.0.1", resolve));
    reviewerUrl = `http://127.0.0.1:${(reviewer.address() as AddressInfo).port}/v1/chat/completions`;

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
    if (realHttpAdapter) registerServerAdapter(realHttpAdapter);
    await new Promise<void>((resolve) => reviewer.close(() => resolve()));
    await tempDb?.cleanup();
  });

  async function seedTeamWithReviewer() {
    const companyId = randomUUID();
    const workerId = randomUUID();
    const reviewerId = randomUUID();
    const parentId = randomUUID();
    const childId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Todero",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values([
      {
        id: workerId,
        companyId,
        name: "Nova",
        role: "general",
        status: "active",
        adapterType: "http",
        adapterConfig: {
          url: "http://127.0.0.1:11434/v1/chat/completions",
          method: "POST",
          model: "qwen2.5-coder:14b",
          localLlm: {
            runtimeId: "ollama",
            runtimeLabel: "Ollama",
            baseUrl: "http://127.0.0.1:11434",
            modelId: "qwen2.5-coder:14b",
          },
        },
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
        runtimeConfig: { heartbeat: { wakeOnDemand: false } },
        permissions: {},
        metadata: { [JUDGE_AGENT_METADATA_KEY]: { version: JUDGE_AGENT_METADATA_VERSION, forAgentId: workerId } },
      },
    ]);
    await db.insert(issues).values([
      {
        id: parentId,
        companyId,
        title: "Fill a table of five strangers for dinner in Tampa",
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
        title: "One-page concept",
        description: "Goal: seat strangers together.\nHand in: the one-page concept.",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: workerId,
        issueNumber: 2,
        identifier: `${issuePrefix}-2`,
      },
    ]);
    return { workerId, reviewerId, childId };
  }

  it("already reads in review when the reviewer is asked, and stays there after the verdict", async () => {
    const { workerId, reviewerId, childId } = await seedTeamWithReviewer();
    childIssueId = childId;

    const run = await heartbeat.invoke(workerId, "assignment", { issueId: childId, wakeReason: "issue_assigned" });
    expect(run).not.toBeNull();

    // The reviewer's verdict is the last thing the turn writes; wait for it.
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
    await drainHeartbeatRunsToQuiescence(db, heartbeat);

    // The moment that mattered on the loop: what the task said while the
    // reviewer was still thinking.
    expect(seenByReviewer).toHaveLength(1);
    expect(seenByReviewer[0]!.status).toBe("blocked");
    expect(seenByReviewer[0]!.description).toContain(REVIEW_PENDING_MARKER);

    // And afterwards: handed in, reviewed, waiting for the person to accept.
    const after = await db
      .select({ status: issues.status, description: issues.description })
      .from(issues)
      .where(eq(issues.id, childId))
      .then((rows) => rows[0]!);
    expect(after.status).toBe("blocked");
    expect(after.description ?? "").toContain(REVIEW_PENDING_MARKER);
  }, 40_000);
});

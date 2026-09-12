// Gauntlet item 0, done-when 3: "after a timed-out turn on a conversational
// local agent, Todero retries once quietly; only if the retry also fails does
// it post one plain notice and hold the task for the person. Tested with a fake
// adapter that times out."
//
// The pure policy is unit-tested in src/todero/slow-local-turn.test.ts and the
// timeout floor has its own repro. What was missing, and what this covers, is
// the live sequence against a real database: a real turn on a fake http adapter
// that always runs out of time, and then the second leg driven from the very
// row the first leg produced.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentRuntimeState,
  agentWakeupRequests,
  agents,
  authUsers,
  companies,
  companySkills,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issues,
} from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";
import { getServerAdapter, registerServerAdapter, type ServerAdapterModule } from "../adapters/index.ts";
import { heartbeatService } from "../services/heartbeat.ts";
import { issueService } from "../services/issues.ts";
import { WAITING_ON_YOU_MARKER } from "../todero/conversation-thread.ts";
import { applySlowLocalTurnRecovery } from "../todero/slow-local-turn-runtime.ts";
import {
  SLOW_LOCAL_TURN_HELD_NOTICE_BODY,
  SLOW_LOCAL_TURN_RETRY_REASON,
} from "../todero/slow-local-turn.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres slow local turn tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/** The hire the wave-1 live loop made: a model on this machine, over a chat endpoint. */
const LOCAL_MODEL_CONFIG = {
  url: "http://127.0.0.1:11434/v1/chat/completions",
  method: "POST",
  model: "qwen2.5-coder:14b",
  localLlm: {
    runtimeId: "ollama",
    runtimeLabel: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    modelId: "qwen2.5-coder:14b",
  },
};

async function waitForRunToFinish(
  heartbeat: ReturnType<typeof heartbeatService>,
  runId: string,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await heartbeat.getRun(runId);
    if (run && !["queued", "running"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return await heartbeat.getRun(runId);
}

describeEmbeddedPostgres("a model on this machine that runs out of time", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let realHttpAdapter: ServerAdapterModule | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-slow-local-turn-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
    // The fake adapter the item asks for: the same "http" agents really use,
    // answering the way the real one does when the model never replies in time.
    realHttpAdapter = getServerAdapter("http");
    registerServerAdapter({
      ...realHttpAdapter,
      execute: async () => ({
        exitCode: null,
        signal: null,
        timedOut: true,
        errorMessage: "HTTP POST http://127.0.0.1:11434/v1/chat/completions timed out after 600000ms",
        errorCode: "timeout",
      }),
    });
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

  afterEach(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    await db.delete(activityLog);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companySkills);
    await db.delete(companies);
  });

  afterAll(async () => {
    if (realHttpAdapter) registerServerAdapter(realHttpAdapter);
    await tempDb?.cleanup();
  });

  async function seedLocalModelTeam() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Todero",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "LocalCoder",
      role: "engineer",
      status: "active",
      adapterType: "http",
      adapterConfig: LOCAL_MODEL_CONFIG,
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Write the release note",
      description: "Draft the note for this week.",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    return { companyId, agentId, issueId };
  }

  function commentsOn(issueId: string) {
    return db.select({ body: issueComments.body }).from(issueComments).where(eq(issueComments.issueId, issueId));
  }

  /** The retry row is written after the turn terminalizes, so wait for it. */
  async function waitForRetryOf(sourceRunId: string) {
    await expect
      .poll(
        () =>
          db
            .select({ id: heartbeatRuns.id })
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.retryOfRunId, sourceRunId))
            .then((rows) => rows.length),
        { timeout: 10_000, interval: 50 },
      )
      .toBe(1);
    return await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.retryOfRunId, sourceRunId))
      .then((rows) => rows[0]!);
  }

  it("says nothing the first time, and quietly lines up one more try", async () => {
    const { agentId, issueId } = await seedLocalModelTeam();

    const run = await heartbeat.invoke(agentId, "assignment", { issueId, wakeReason: "issue_assigned" });
    expect(run).not.toBeNull();
    const finished = await waitForRunToFinish(heartbeat, run!.id);
    expect(finished?.status).toBe("timed_out");
    expect(finished?.errorCode).toBe("timeout");

    const retry = await waitForRetryOf(run!.id);
    expect(retry.status).toBe("scheduled_retry");
    expect(retry.scheduledRetryReason).toBe(SLOW_LOCAL_TURN_RETRY_REASON);

    // The quiet try is quiet: nothing was said to the person, and the task is
    // still where it was. On the wave-1 loop this is where the notices piled up.
    expect(await commentsOn(issueId)).toEqual([]);
    const issue = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, issueId));
    expect(issue[0]?.status).toBe("in_progress");
  }, 30_000);

  it("says it once when the second try runs out too, and never twice", async () => {
    const { agentId, issueId } = await seedLocalModelTeam();

    const first = await heartbeat.invoke(agentId, "assignment", { issueId, wakeReason: "issue_assigned" });
    await waitForRunToFinish(heartbeat, first!.id);

    // The row the first leg produced, not a hand-built one: the turn that the
    // quiet try will run, already carrying its retry reason.
    const queuedRetry = await waitForRetryOf(first!.id);
    expect(queuedRetry.scheduledRetryReason).toBe(SLOW_LOCAL_TURN_RETRY_REASON);

    const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((rows) => rows[0]!);
    const deps = {
      db,
      issues: issueService(db),
      appendRunEvent: async () => undefined,
      nextRunEventSeq: async () => 1,
      scheduleRetry: async () => {
        throw new Error("the quiet try must never be tried a second time");
      },
    };
    const timedOutRetry = { ...queuedRetry, errorCode: "timeout" };

    await applySlowLocalTurnRecovery({ outcome: "timed_out", run: timedOutRetry, agent, issueId, deps });

    expect((await commentsOn(issueId)).map((row) => row.body)).toEqual([SLOW_LOCAL_TURN_HELD_NOTICE_BODY]);
    const held = await db
      .select({ status: issues.status, description: issues.description })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]!);
    expect(held.status).toBe("blocked");
    expect(held.description ?? "").toContain(WAITING_ON_YOU_MARKER);

    // A third pass over the same task says nothing more.
    await applySlowLocalTurnRecovery({ outcome: "timed_out", run: timedOutRetry, agent, issueId, deps });
    expect((await commentsOn(issueId)).map((row) => row.body)).toEqual([SLOW_LOCAL_TURN_HELD_NOTICE_BODY]);
  }, 30_000);
});

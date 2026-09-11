/**
 * Pause is only useful if the scheduler honours it, and only reversible if
 * nothing is thrown away while it holds. Both halves are asserted here against
 * a real database: the timer tick creates no run for a paused organization,
 * and a queued wake that existed before the pause is still there afterwards
 * and starts once the organization is resumed.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentRuntimeState,
  agentWakeupRequests,
  agents,
  companies,
  companySkills,
  createDb,
  documentRevisions,
  documents,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issues,
} from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Paused-company guard test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres paused-company heartbeat guard tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the expected condition");
}

describeEmbeddedPostgres("heartbeat paused-company guard", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-paused-company-guard-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    // Quiesce before the tables go away. A finished run can legitimately chain
    // more work, so a single snapshot of run ids is not enough: pausing every
    // organization first stops the scheduler from starting anything new — the
    // guarantee this file exists to prove — and then whatever was already in
    // flight is waited out, re-reading the table each pass because a chained run
    // can appear while an earlier one is still draining. A wake already claimed
    // is the other half: it has no run row yet, and letting the pool close under
    // it is what printed CONNECTION_ENDED here. A wake still queued is not
    // waited for — every organization is paused by the line below, so a queued
    // wake stays queued on purpose and waiting for it would never return. A
    // write that landed after the delete would fail the next test instead of
    // this one.
    await db
      .update(companies)
      .set({ status: "paused", pauseReason: "manual", pausedAt: new Date() });
    const quietDeadline = Date.now() + 30_000;
    let quietPasses = 0;
    while (Date.now() < quietDeadline && quietPasses < 3) {
      const runs = await db
        .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
        .from(heartbeatRuns);
      // A wake taken off the queue but not yet turned into a run row.
      const inFlightWakeups = await db
        .select({ status: agentWakeupRequests.status })
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.status, "claimed"));
      await Promise.all(
        runs.map((run) =>
          heartbeat.waitForRunExecutionDrain(run.id, { timeoutMs: 15_000 }).catch(() => undefined),
        ),
      );
      // Start the count again while a run is going or a wake is mid-flight.
      quietPasses = runs.some((run) => run.status === "running") || inFlightWakeups.length > 0 ? 0 : quietPasses + 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await db.delete(environmentLeases);
    await db.delete(activityLog);
    await db.delete(companySkills);
    await db.delete(issueComments);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function insertPausedCompanyWithAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paused Co",
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-09-10T10:42:00Z"),
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Paused Agent",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 60,
          wakeOnDemand: true,
        },
      },
      permissions: {},
    });

    return { companyId, agentId };
  }

  it("creates no run for a paused organization on a timer tick", async () => {
    const { agentId } = await insertPausedCompanyWithAgent();

    const result = await heartbeat.tickTimers(new Date("2026-09-10T11:10:00Z"));

    expect(result).toMatchObject({ checked: 0, enqueued: 0, skipped: 0 });

    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
    expect(runs).toHaveLength(0);
  });

  it("keeps a queued wake through the pause and starts it once the organization is resumed", async () => {
    const { companyId, agentId } = await insertPausedCompanyWithAgent();
    const issueId = randomUUID();
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Queued before the pause",
      status: "todo",
      assigneeAgentId: agentId,
    });
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      status: "queued",
      responsibleUserId: "responsible-user",
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "queued",
      wakeupRequestId,
      responsibleUserId: "responsible-user",
      contextSnapshot: { issueId, wakeReason: "issue_assigned" },
    });

    // While paused: the queued work is neither started nor thrown away.
    await heartbeat.resumeQueuedRuns();
    const whilePaused = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    expect(whilePaused?.status).toBe("queued");

    // Play: the same row picks up where it stopped; nothing is re-created.
    await db.update(companies).set({ status: "active", pauseReason: null, pausedAt: null }).where(eq(companies.id, companyId));
    await heartbeat.resumeQueuedRuns();
    await waitForCondition(async () => {
      const run = await db
        .select({ status: heartbeatRuns.status })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0] ?? null);
      return run?.status === "succeeded";
    });

    // What resume promises is that the row that was waiting is the row that
    // ran — not that the organization stays still afterwards. A finished run
    // chains its own follow-up work (here the agent never wrote on the ticket,
    // so the service asks it again), so this is scoped to the wake that was
    // queued before the pause rather than counting every row in the table.
    const runsForQueuedWake = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.wakeupRequestId, wakeupRequestId));
    expect(runsForQueuedWake).toEqual([{ id: runId, status: "succeeded" }]);

    // And nothing was re-created for it: the original request is the only
    // assignment wake, and it was consumed rather than left behind or replaced.
    const assignmentWakes = await db
      .select({ id: agentWakeupRequests.id, status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.reason, "issue_assigned"));
    expect(assignmentWakes.map((row) => row.id)).toEqual([wakeupRequestId]);
    expect(assignmentWakes[0]?.status).not.toBe("queued");
  }, 60_000);

  it("queues a new wake while an organization is paused and runs it once resumed", async () => {
    const { companyId, agentId } = await insertPausedCompanyWithAgent();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Answered during the pause",
      status: "todo",
      assigneeAgentId: agentId,
    });

    // The person answers while paused: the wake is kept, not thrown away.
    const run = await heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_commented",
      payload: { issueId, commentId: randomUUID() },
      requestedByActorType: "system",
      requestedByActorId: "comment_wake",
    });
    expect(run).not.toBeNull();
    const skipped = await db
      .select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, agentId))
      .then((rows) => rows.filter((row) => row.status === "skipped"));
    expect(skipped).toEqual([]);

    // Still paused: it waits.
    await heartbeat.resumeQueuedRuns();
    const whilePaused = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, run!.id))
      .then((rows) => rows[0] ?? null);
    expect(whilePaused?.status).toBe("queued");

    // Play: it runs.
    await db.update(companies).set({ status: "active", pauseReason: null, pausedAt: null }).where(eq(companies.id, companyId));
    await heartbeat.resumeQueuedRuns();
    await waitForCondition(async () => {
      const row = await db
        .select({ status: heartbeatRuns.status })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, run!.id))
        .then((rows) => rows[0] ?? null);
      return row?.status === "succeeded";
    });
  }, 60_000);
});

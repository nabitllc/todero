// The way back for a task parked with nothing on it to answer, against a real
// database.
//
// parked-turn-recovery.test.ts stands in for the database and tests the rule on
// its own. Everything here needs a database to be true at all: which stopped
// tasks are picked up is SQL and the last two things said on a task, and what
// happens to a task afterwards is the corrective turn the heartbeat applies at
// the end of a bad turn, run from the other door.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, authUsers, companies, createDb, issueComments, issues } from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { descriptionWithEmptyTurnTries, readEmptyTurnTries } from "./conversation-outcome.js";
import { descriptionWithWaitingMarker, hasWaitingOnYouNote } from "./conversation-thread.js";
import { EMPTY_TURN_MAX_TRIES, EMPTY_TURN_RETRY_WAKE_REASON } from "./empty-turn-recovery.js";
import {
  loadParkedTasksWithNothingToAnswer,
  recoverParkedTurns,
  type ParkedTurnWakeup,
} from "./parked-turn-recovery.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping the embedded Postgres parked-turn tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const BRIEF = "<!-- todero-type: Task -->\nDraft the second guide.";

/** ZZGAAAAAAAAA-4's reply on 2026-09-21: its own brief read back, and no guide. */
const NOTHING_TO_ANSWER = [
  "**ZZGAAAAAAAAA-4**",
  "- **Goal:** Create four one-page guides for houseplants that survive a dark flat.",
  "- **Feature:** Draft guides — To produce the initial content for the one-page guides.",
  "- **Done when:** Four drafts, each naming the plant, the light it needs, and how often to water it.",
].join("\n");

describeEmbeddedPostgres("a task parked with nothing to answer, against a real database", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  /** Every agent the code asked to be brought back, and why. */
  let woken: { agentId: string; reason: string }[] = [];

  const wakeup: ParkedTurnWakeup = async (agentId, wake) => {
    woken.push({ agentId, reason: wake.reason });
    return null;
  };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-parked-turn-db-");
    db = createDb(tempDb.connectionString);
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
    woken = [];
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  type Seeded = { companyId: string; workerId: string; parentId: string; taskId: string };

  /** One organization parked the way wave 19 left it. */
  async function seed(options: {
    status?: string;
    description?: string;
    /** What the worker said last, if anything. */
    lastSaid?: string | null;
    /** A person answered after the worker did. */
    personAnswered?: string;
  } = {}): Promise<Seeded> {
    const companyId = randomUUID();
    const workerId = randomUUID();
    const parentId = randomUUID();
    const taskId = randomUUID();
    const issuePrefix = `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Zz Gauntlet Org",
      issuePrefix,
      status: options.status ?? "active",
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
      interactionResolverGovernance: {},
    });
    await db.insert(agents).values({
      id: workerId,
      companyId,
      name: "Nova",
      role: "general",
      status: "active",
      adapterType: "http",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values([
      {
        id: parentId,
        companyId,
        title: "Four guides for a dark flat",
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
        title: "Draft the second guide",
        description: options.description ?? descriptionWithWaitingMarker(BRIEF, true),
        status: "blocked",
        priority: "medium",
        assigneeAgentId: workerId,
        issueNumber: 2,
        identifier: `${issuePrefix}-2`,
      },
    ]);
    const said = options.lastSaid === undefined ? NOTHING_TO_ANSWER : options.lastSaid;
    if (said !== null) {
      await issueService(db).addComment(taskId, said, { agentId: workerId });
    }
    if (options.personAnswered) {
      await issueService(db).addComment(taskId, options.personAnswered, { userId: "responsible-user" });
    }
    return { companyId, workerId, parentId, taskId };
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

  const resume = (companyId: string) =>
    recoverParkedTurns(db, { enqueueWakeup: wakeup, log: () => {} }, { companyId });

  it("starts it again once, and leaves it alone the second time", async () => {
    const { companyId, workerId, taskId } = await seed();
    expect((await loadParkedTasksWithNothingToAnswer(db, companyId)).map((task) => task.id)).toEqual([taskId]);

    const first = await resume(companyId);
    expect(first).toMatchObject({ restarted: 1, failed: 0, stopped: false });

    const task = await readTask(taskId);
    // Off the person's desk, started again, and counted as the one try.
    expect(task.status).toBe("todo");
    expect(hasWaitingOnYouNote(task.description)).toBe(false);
    expect(readEmptyTurnTries(task.description)).toBe(EMPTY_TURN_MAX_TRIES);
    expect(woken).toEqual([{ agentId: workerId, reason: EMPTY_TURN_RETRY_WAKE_REASON }]);
    const said = await commentsOn(taskId);
    expect(said.at(-1)).toContain("Todero is asking it once more for the work itself");
    expect(said.at(-1)).not.toMatch(/todero-|marker|disposition/i);

    // A second start finds nothing: the task is already on its way.
    woken = [];
    expect(await resume(companyId)).toMatchObject({ restarted: 0 });
    expect(woken).toEqual([]);
  });

  it("leaves a task Todero has already asked once", async () => {
    const { companyId, taskId } = await seed({
      description: descriptionWithEmptyTurnTries(descriptionWithWaitingMarker(BRIEF, true), EMPTY_TURN_MAX_TRIES),
    });
    expect(await loadParkedTasksWithNothingToAnswer(db, companyId)).toEqual([]);
    expect(await resume(companyId)).toMatchObject({ restarted: 0 });
    expect(await readTask(taskId)).toMatchObject({ status: "blocked" });
  });

  it("leaves a task a person has already answered", async () => {
    const { companyId, taskId } = await seed({ personAnswered: "Just do the pothos one." });
    expect(await loadParkedTasksWithNothingToAnswer(db, companyId)).toEqual([]);
    expect(await resume(companyId)).toMatchObject({ restarted: 0 });
    expect(await readTask(taskId)).toMatchObject({ status: "blocked" });
  });

  it("leaves a task that asked the person for something", async () => {
    const { companyId, taskId } = await seed({
      lastSaid: "Could you please provide the four draft guides so I can review them?",
    });
    expect(await loadParkedTasksWithNothingToAnswer(db, companyId)).toEqual([]);
    expect(await resume(companyId)).toMatchObject({ restarted: 0 });
    expect(await readTask(taskId)).toMatchObject({ status: "blocked" });
  });

  it("does nothing while the organization is on hold", async () => {
    const { companyId, taskId } = await seed({ status: "paused" });
    // It is found — the hold is not written on the task — and then left where
    // it is, because nothing may be started while an organization is held.
    expect((await loadParkedTasksWithNothingToAnswer(db, companyId)).map((task) => task.id)).toEqual([taskId]);
    expect(await resume(companyId)).toMatchObject({ restarted: 0, stopped: true });
    expect(await readTask(taskId)).toMatchObject({ status: "blocked" });
    expect(woken).toEqual([]);
  });
});

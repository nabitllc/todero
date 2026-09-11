/**
 * Play / Pause for an organization, and one master switch for the whole
 * instance.
 *
 * Pause is deliberately lighter than archive. Archive cascades: it pauses
 * every agent, cancels what is queued, and restores all of that when the
 * company comes back. Pause only flips the company's own three columns —
 * `status`, `pauseReason`, `pausedAt`. Work already under way finishes on its
 * own; nothing new starts, because every scheduler path already asks for
 * `companies.status = 'active'`; and everything that was queued stays queued,
 * so Play picks up exactly where Pause left off without re-creating anything.
 *
 * The writes are single statements with the expected status in the WHERE
 * clause. That is what makes "refuse a second pause" correct when two requests
 * arrive at once: the second one updates no rows and answers 409.
 */
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { companies, type Db } from "@todero/db";
import { COMPANY_PAUSE_REASON_MANUAL, COMPANY_PAUSE_REASON_MASTER } from "@todero/shared";
import { conflict, notFound } from "../errors.js";
import {
  assertBoard,
  assertCompanyAccess,
  assertInstanceAdmin,
  getActorInfo,
} from "./authz.js";
import {
  logActivity,
  publishActivity,
  type ActivityPublication,
} from "../services/activity-log.js";
import { logger } from "../middleware/logger.js";

/**
 * The reason this route writes. Always `manual`: only the instance-wide switch
 * writes `master`, and that distinction is the whole reason "Resume
 * everything" can leave a hand-paused organization alone. A body asking for
 * anything else is a manual pause rather than an error, so a stale client
 * cannot fail a pause the person meant.
 */
export function readPauseReason(_body: unknown): string {
  return COMPANY_PAUSE_REASON_MANUAL;
}

/**
 * Publishing an activity line must never fail the switch itself: the columns
 * are already written by the time we get here, and a person who pressed Pause
 * cares that the organization is paused, not that a feed subscriber heard it.
 */
function publishBestEffort(publications: ActivityPublication[], action: string) {
  for (const publication of publications) {
    try {
      publishActivity(publication);
    } catch (err) {
      logger.warn({ err, action, companyId: publication.companyId }, "failed to publish a pause activity line");
    }
  }
}

export type ToderoPauseRouteDeps = {
  /** Kicks queued runs the moment an organization resumes, instead of on the next scheduler tick. */
  heartbeat?: { resumeQueuedRuns: () => Promise<unknown> };
};

function kickQueuedRuns(deps: ToderoPauseRouteDeps | undefined, scope: string) {
  const heartbeat = deps?.heartbeat;
  if (!heartbeat) return;
  heartbeat.resumeQueuedRuns().catch((err: unknown) => {
    logger.warn({ err, scope }, "failed to start queued runs after resume; the scheduler will on its next tick");
  });
}

export function toderoPauseRoutes(db: Db, deps?: ToderoPauseRouteDeps) {
  const router = Router();

  async function readCompany(companyId: string) {
    const rows = await db
      .select({ id: companies.id, status: companies.status, pauseReason: companies.pauseReason })
      .from(companies)
      .where(eq(companies.id, companyId));
    return rows[0] ?? null;
  }

  router.post("/companies/:companyId/pause", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);

    const existing = await readCompany(companyId);
    if (!existing) throw notFound("Company not found");
    if (existing.status !== "active") {
      throw conflict("This organization is already paused", { status: existing.status });
    }

    const pausedAt = new Date();
    const reason = readPauseReason(req.body);
    const company = await db
      .update(companies)
      .set({ status: "paused", pauseReason: reason, pausedAt, updatedAt: new Date() })
      .where(and(eq(companies.id, companyId), eq(companies.status, "active")))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!company) {
      // Someone else got there between the read and the write.
      throw conflict("This organization is already paused", { status: "paused" });
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "company.paused",
      entityType: "company",
      entityId: companyId,
      details: { reason, pausedAt: pausedAt.toISOString(), scope: "company" },
    });
    res.json(company);
  });

  router.post("/companies/:companyId/resume", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);

    const existing = await readCompany(companyId);
    if (!existing) throw notFound("Company not found");
    if (existing.status !== "paused") {
      throw conflict("This organization is not paused", { status: existing.status });
    }

    const company = await db
      .update(companies)
      .set({ status: "active", pauseReason: null, pausedAt: null, updatedAt: new Date() })
      .where(and(eq(companies.id, companyId), eq(companies.status, "paused")))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!company) {
      throw conflict("This organization is not paused", { status: "active" });
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "company.resumed",
      entityType: "company",
      entityId: companyId,
      details: { scope: "company", previousReason: existing.pauseReason },
    });
    kickQueuedRuns(deps, "company");
    res.json(company);
  });

  /**
   * Pause everything. Only organizations that are active right now are
   * touched, and each is tagged `master` so Resume everything can tell them
   * apart from one the person paused by hand.
   */
  router.post("/instance/pause-all", async (req, res) => {
    assertInstanceAdmin(req);
    const pausedAt = new Date();
    const paused = await db
      .update(companies)
      .set({ status: "paused", pauseReason: COMPANY_PAUSE_REASON_MASTER, pausedAt, updatedAt: new Date() })
      .where(eq(companies.status, "active"))
      .returning({ id: companies.id });

    const actor = getActorInfo(req);
    const publications: ActivityPublication[] = [];
    for (const company of paused) {
      await logActivity(db, {
        companyId: company.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "company.paused",
        entityType: "company",
        entityId: company.id,
        details: {
          reason: COMPANY_PAUSE_REASON_MASTER,
          pausedAt: pausedAt.toISOString(),
          scope: "instance",
        },
      }, publications);
    }
    publishBestEffort(publications, "company.paused");
    res.json({ paused: paused.length, companyIds: paused.map((row) => row.id) });
  });

  /**
   * Resume everything — but only what this switch paused. An organization the
   * person paused by hand keeps its own pause, which is the whole reason the
   * reason column is written in the first place.
   */
  router.post("/instance/resume-all", async (req, res) => {
    assertInstanceAdmin(req);
    const resumed = await db
      .update(companies)
      .set({ status: "active", pauseReason: null, pausedAt: null, updatedAt: new Date() })
      .where(and(eq(companies.status, "paused"), eq(companies.pauseReason, COMPANY_PAUSE_REASON_MASTER)))
      .returning({ id: companies.id });

    const actor = getActorInfo(req);
    const publications: ActivityPublication[] = [];
    for (const company of resumed) {
      await logActivity(db, {
        companyId: company.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "company.resumed",
        entityType: "company",
        entityId: company.id,
        details: { scope: "instance", previousReason: COMPANY_PAUSE_REASON_MASTER },
      }, publications);
    }
    publishBestEffort(publications, "company.resumed");
    kickQueuedRuns(deps, "instance");
    res.json({ resumed: resumed.length, companyIds: resumed.map((row) => row.id) });
  });

  return router;
}

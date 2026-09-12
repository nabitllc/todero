import { eq } from "drizzle-orm";
import type { Db } from "@todero/db";
import { agents } from "@todero/db";
import { LOCAL_MODEL_TIMEOUT_FLOOR_MS } from "@todero/shared";
import { isLocalModelAdapterConfig } from "../adapters/http/local-model-timeout.js";

/**
 * Written on the agent's adapter config once its wait has been raised, so a
 * second start leaves it alone — and so a person who lowers it later on
 * purpose keeps their own number.
 */
export const LOCAL_MODEL_TIMEOUT_STAMP_KEY = "toderoTimeoutFlooredAt";

export type LocalModelTimeoutBackfillResult = {
  companiesProcessed: number;
  agentsBackfilled: number;
  /** Only the organizations something changed in, for one log line each. */
  perCompany: Array<{ companyId: string; agentsBackfilled: number }>;
};

/**
 * Agents hired before this floor existed wrote 180 s for a model on this
 * machine, and a busy machine takes longer than that for a single turn. The
 * call itself already floors the wait, so nothing is broken without this; the
 * backfill is what makes the number a person reads on the Agents page match
 * what actually happens.
 *
 * Only an http agent pointed at a model on this machine, whose wait is below
 * the floor and which has never been stamped, is touched. Idempotent, and the
 * caller has already dropped archived and paused organizations.
 */
export async function runLocalModelTimeoutBackfill(
  db: Db,
  companyIds: Array<{ id: string }>,
): Promise<LocalModelTimeoutBackfillResult> {
  let totalBackfilled = 0;
  const perCompany: Array<{ companyId: string; agentsBackfilled: number }> = [];

  for (const org of companyIds) {
    const roster = await db
      .select({ id: agents.id, adapterType: agents.adapterType, adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.companyId, org.id));

    let backfilledHere = 0;
    for (const agent of roster) {
      if (agent.adapterType !== "http") continue;

      const adapterConfig = (agent.adapterConfig ?? {}) as Record<string, unknown>;
      if (adapterConfig[LOCAL_MODEL_TIMEOUT_STAMP_KEY] !== undefined) continue;
      if (!isLocalModelAdapterConfig(adapterConfig)) continue;

      const configured =
        typeof adapterConfig.timeoutMs === "number" && Number.isFinite(adapterConfig.timeoutMs)
          ? adapterConfig.timeoutMs
          : 0;
      if (configured >= LOCAL_MODEL_TIMEOUT_FLOOR_MS) continue;

      await db
        .update(agents)
        .set({
          adapterConfig: {
            ...adapterConfig,
            timeoutMs: LOCAL_MODEL_TIMEOUT_FLOOR_MS,
            [LOCAL_MODEL_TIMEOUT_STAMP_KEY]: new Date().toISOString(),
          },
        })
        .where(eq(agents.id, agent.id));

      totalBackfilled += 1;
      backfilledHere += 1;
    }
    if (backfilledHere > 0) perCompany.push({ companyId: org.id, agentsBackfilled: backfilledHere });
  }

  return { companiesProcessed: companyIds.length, agentsBackfilled: totalBackfilled, perCompany };
}

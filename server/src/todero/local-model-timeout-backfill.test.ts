import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "@todero/db";
import { LOCAL_MODEL_TIMEOUT_FLOOR_MS } from "@todero/shared";
import { runStartupBackfills } from "./startup-backfills.js";
import { LOCAL_MODEL_TIMEOUT_STAMP_KEY } from "./local-model-timeout-backfill.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

/** What a hire made before the floor existed wrote down. */
const WAVE_ONE_ADAPTER_CONFIG = {
  url: "http://127.0.0.1:11434/v1/chat/completions",
  method: "POST",
  timeoutMs: 180_000,
  model: "qwen2.5-coder:14b",
  localLlm: { runtimeId: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5-coder:14b" },
};

describeEmbeddedPostgres("local model timeout backfill", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-local-model-timeout-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createOrg(status?: string) {
    return db
      .insert(companies)
      .values({
        name: `Local Model ${randomUUID()}`,
        issuePrefix: `LM${randomUUID().slice(0, 6).toUpperCase()}`,
        ...(status ? { status } : {}),
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function createAgent(companyId: string, adapterConfig: Record<string, unknown>, adapterType = "http") {
    return db
      .insert(agents)
      .values({ companyId, name: `Agent ${randomUUID().slice(0, 6)}`, adapterType, adapterConfig })
      .returning()
      .then((rows) => rows[0]!);
  }

  const configOf = async (id: string) =>
    db
      .select({ adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, id))
      .then((rows) => rows[0]!.adapterConfig as Record<string, unknown>);

  it("raises the wait an agent hired before the floor wrote down", async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, WAVE_ONE_ADAPTER_CONFIG);

    const result = await runStartupBackfills(db);

    expect(result.localModelTimeoutBackfill.agentsBackfilled).toBe(1);
    const config = await configOf(agent.id);
    expect(config.timeoutMs).toBe(LOCAL_MODEL_TIMEOUT_FLOOR_MS);
    expect(typeof config[LOCAL_MODEL_TIMEOUT_STAMP_KEY]).toBe("string");
    // Everything else on the config is left exactly as it was.
    expect(config.model).toBe("qwen2.5-coder:14b");
    expect(config.localLlm).toEqual(WAVE_ONE_ADAPTER_CONFIG.localLlm);
  });

  it("recognises a loopback chat endpoint without the block the wizard writes", async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, {
      url: "http://localhost:11434/v1/chat/completions",
      timeoutMs: 180_000,
    });

    await runStartupBackfills(db);

    expect((await configOf(agent.id)).timeoutMs).toBe(LOCAL_MODEL_TIMEOUT_FLOOR_MS);
  });

  it("leaves a webhook somewhere else exactly as it was", async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { url: "https://example.test/webhook", timeoutMs: 30_000 });

    const result = await runStartupBackfills(db);

    expect(result.localModelTimeoutBackfill.agentsBackfilled).toBe(0);
    const config = await configOf(agent.id);
    expect(config.timeoutMs).toBe(30_000);
    expect(config[LOCAL_MODEL_TIMEOUT_STAMP_KEY]).toBeUndefined();
  });

  it("keeps a longer wait somebody set on purpose", async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { ...WAVE_ONE_ADAPTER_CONFIG, timeoutMs: 1_200_000 });

    const result = await runStartupBackfills(db);

    expect(result.localModelTimeoutBackfill.agentsBackfilled).toBe(0);
    expect((await configOf(agent.id)).timeoutMs).toBe(1_200_000);
  });

  it("changes nothing on a second start, and never undoes a later choice", async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, WAVE_ONE_ADAPTER_CONFIG);

    await runStartupBackfills(db);
    const stamped = await configOf(agent.id);

    // Somebody lowers it on purpose afterwards; the stamp stays.
    await db
      .update(agents)
      .set({ adapterConfig: { ...stamped, timeoutMs: 90_000 } })
      .where(eq(agents.id, agent.id));

    const second = await runStartupBackfills(db);

    expect(second.localModelTimeoutBackfill.agentsBackfilled).toBe(0);
    expect(second.localModelTimeoutBackfill.perCompany).toEqual([]);
    expect((await configOf(agent.id)).timeoutMs).toBe(90_000);
  });

  it("leaves a paused organization exactly as it was", async () => {
    const org = await createOrg("paused");
    const agent = await createAgent(org.id, WAVE_ONE_ADAPTER_CONFIG);

    const result = await runStartupBackfills(db);

    expect(result.localModelTimeoutBackfill.agentsBackfilled).toBe(0);
    expect((await configOf(agent.id)).timeoutMs).toBe(180_000);
  });

  it("leaves an archived organization exactly as it was", async () => {
    const org = await createOrg("archived");
    const agent = await createAgent(org.id, WAVE_ONE_ADAPTER_CONFIG);

    const result = await runStartupBackfills(db);

    expect(result.localModelTimeoutBackfill.agentsBackfilled).toBe(0);
    expect((await configOf(agent.id)).timeoutMs).toBe(180_000);
  });
});

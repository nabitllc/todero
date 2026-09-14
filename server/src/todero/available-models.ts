/**
 * Which local models this machine can actually serve, remembered per
 * organization.
 *
 * Model routing (`model-routing.ts`, read by the http adapter) ranks a flat
 * list of model ids to pick a stronger or faster model for a given kind of
 * turn. That list has to come from somewhere: it is what the connection test
 * and the detect endpoint already read from the runtime. It is kept in the
 * organization's existing settings blob (`interactionResolverGovernance`) —
 * no new column — and refreshed whenever a connection test passes.
 */
import { companies, type Db } from "@todero/db";
import { eq } from "drizzle-orm";
import { detectLocalLlms } from "./local-llm-detect.js";

/** The key inside `interactionResolverGovernance`. Mirrored in @todero/shared. */
export const AVAILABLE_MODEL_IDS_KEY = "toderoLocalLlmAvailableModelIds";
/** The context window, in tokens, the runtime served the organization's model with. */
export const CONTEXT_LENGTH_KEY = "toderoLocalLlmContextLength";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").toLowerCase();
}

/** The model ids stored for an organization, in stored order. */
export function readStoredAvailableModelIds(governance: unknown): string[] {
  const raw = asRecord(governance)[AVAILABLE_MODEL_IDS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

/**
 * The model ids the runtime at `baseUrl` serves. Empty when nothing is
 * listening there — the caller keeps whatever it had rather than storing an
 * empty list.
 */
export async function detectAvailableModelIds(baseUrl: string): Promise<string[]> {
  const wanted = normalizeBaseUrl(baseUrl);
  if (!wanted) return [];
  const detected = await detectLocalLlms();
  for (const runtime of detected.runtimes) {
    const candidate = normalizeBaseUrl(runtime.baseUrl);
    // The agent's adapter URL carries the completions path
    // (".../v1/chat/completions"); the detected runtime carries the root.
    if (candidate && (candidate === wanted || wanted.startsWith(`${candidate}/`))) {
      return runtime.models.map((model) => model.id).filter((id) => id.trim().length > 0);
    }
  }
  return [];
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Remember the list for an organization. A no-op when the list is empty or
 * unchanged, so a passing test does not write on every call.
 */
export async function storeAvailableModelIds(
  db: Db,
  companyId: string,
  modelIds: string[],
): Promise<string[]> {
  const wanted = modelIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  if (wanted.length === 0) return [];
  const rows = await db
    .select({ governance: companies.interactionResolverGovernance })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (rows.length === 0) return [];
  const governance = asRecord(rows[0]?.governance);
  if (sameList(readStoredAvailableModelIds(governance), wanted)) return wanted;
  await db
    .update(companies)
    .set({
      interactionResolverGovernance: { ...governance, [AVAILABLE_MODEL_IDS_KEY]: wanted },
    })
    .where(eq(companies.id, companyId));
  return wanted;
}

/**
 * What the run context should carry for an agent talking to a local model:
 * the stored list, or — the first time, and for organizations hired before
 * this existed — a fresh look at the runtime, remembered for next time.
 */
export async function resolveAvailableModelIdsForRun(
  db: Db,
  input: { companyId: string; baseUrl: string | null },
): Promise<string[]> {
  const rows = await db
    .select({ governance: companies.interactionResolverGovernance })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);
  const stored = readStoredAvailableModelIds(rows[0]?.governance);
  if (stored.length > 0) return stored;
  if (!input.baseUrl) return [];
  const detected = await detectAvailableModelIds(input.baseUrl);
  if (detected.length === 0) return [];
  return storeAvailableModelIds(db, input.companyId, detected);
}

/** The stored context window, or null when no connection test recorded one. */
export function readStoredContextLength(governance: unknown): number | null {
  const raw = asRecord(governance)[CONTEXT_LENGTH_KEY];
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

/**
 * Ask an Ollama runtime what window it is serving a model with. Ollama's
 * /api/ps lists the loaded models with their context_length; the model is
 * loaded right after a connection test, which is when this is asked. Any
 * other runtime, or a runtime that does not say, answers null.
 */
export async function detectContextLength(
  baseUrl: string,
  modelId: string,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  const root = normalizeBaseUrl(baseUrl).replace(/\/v1(\/.*)?$/, "");
  if (!root) return null;
  const loaded = await readLoadedContextLength(root, modelId, fetcher);
  if (loaded) return loaded;
  // /api/ps only lists models the runtime has in memory. A run that starts
  // cold — every backfill for an agent hired before the window was recorded —
  // finds nothing there, so ask the model itself what it was built with.
  return readModelContextLength(root, modelId, fetcher);
}

async function readLoadedContextLength(
  root: string,
  modelId: string,
  fetcher: typeof fetch,
): Promise<number | null> {
  try {
    const response = await fetcher(`${root}/api/ps`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      models?: Array<{ name?: string; model?: string; context_length?: number }>;
    };
    const models = Array.isArray(body.models) ? body.models : [];
    const match = models.find((m) => m.name === modelId || m.model === modelId) ?? models[0];
    return asContextLength(match?.context_length);
  } catch {
    return null;
  }
}

/**
 * Ollama's /api/show reports the model's own architecture, where the window it
 * was built with is `<architecture>.context_length`. It answers whether or not
 * the model is loaded, which is what a backfill needs.
 */
async function readModelContextLength(
  root: string,
  modelId: string,
  fetcher: typeof fetch,
): Promise<number | null> {
  if (!modelId.trim()) return null;
  try {
    const response = await fetcher(`${root}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { model_info?: Record<string, unknown> };
    const info = asRecord(body.model_info);
    for (const [key, value] of Object.entries(info)) {
      if (key.endsWith(".context_length")) {
        const length = asContextLength(value);
        if (length) return length;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function asContextLength(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/** Remember the window for an organization; a no-op when unchanged or unknown. */
export async function storeContextLength(db: Db, companyId: string, contextLength: number | null): Promise<void> {
  if (!contextLength) return;
  const rows = await db
    .select({ governance: companies.interactionResolverGovernance })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (rows.length === 0) return;
  const governance = asRecord(rows[0]?.governance);
  if (readStoredContextLength(governance) === contextLength) return;
  await db
    .update(companies)
    .set({
      interactionResolverGovernance: {
        ...governance,
        [CONTEXT_LENGTH_KEY]: contextLength,
      } as unknown as (typeof companies.$inferInsert)["interactionResolverGovernance"],
    })
    .where(eq(companies.id, companyId));
}

/**
 * The window for a run's organization: the one a connection test recorded, or
 * — for an agent hired before that was kept, and for a hire whose test ran
 * before the organization existed — a fresh look at the runtime, remembered
 * for next time. Null when nothing can say; the caller must not invent one.
 */
export async function resolveContextLengthForRun(
  db: Db,
  companyId: string,
  options: {
    baseUrl?: string | null;
    modelId?: string | null;
    detect?: (baseUrl: string, modelId: string) => Promise<number | null>;
  } = {},
): Promise<number | null> {
  const rows = await db
    .select({ governance: companies.interactionResolverGovernance })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (rows.length === 0) return null;
  const stored = readStoredContextLength(rows[0]?.governance);
  if (stored) return stored;
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
  if (!baseUrl) return null;
  const detect = options.detect ?? ((url: string, model: string) => detectContextLength(url, model));
  const detected = await detect(baseUrl, typeof options.modelId === "string" ? options.modelId.trim() : "");
  if (!detected) return null;
  await storeContextLength(db, companyId, detected);
  return detected;
}

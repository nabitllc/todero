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
/**
 * Set once the recorded window has been checked against the runtime by a run,
 * rather than only written by a connection test. Every organization created
 * before that check existed holds a number that may be an understatement, so
 * the first run re-asks; this is how the second run knows not to.
 *
 * Only the capability endpoint may set it. A window is a fact about the
 * model, and only /api/show answers that question; a reading that came from
 * /api/ps alone is a snapshot of one load, and letting it close the question
 * is how an organization gets pinned to Ollama's 4,096 default for good.
 */
export const CONTEXT_LENGTH_RECHECKED_KEY = "toderoLocalLlmContextLengthRechecked";

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
 * Ask an Ollama runtime how big a window a model can be given.
 *
 * Two endpoints answer, and they answer different questions. /api/ps reports
 * the window the model is *loaded* at right now, which is Ollama's 4,096
 * default unless someone set otherwise. /api/show reports what the model can
 * *hold* — 32,768 for qwen2.5-coder:14b. Both were seen for the same model on
 * the same machine minutes apart.
 *
 * The capability is the answer, so this takes the larger of the two and never
 * lets a loaded-state snapshot lower it. /api/ps is still worth asking, but
 * only about the model being asked about: when someone has deliberately
 * loaded *that* model above its own reported maximum, the window is real and
 * already paid for. A row about some other model says nothing here — one
 * Ollama serves many models and routing switches between them per turn, so
 * the row on top is routinely a different model's. Any other runtime, or a
 * runtime that does not say, answers null.
 *
 * The reading says which of the two answered, because they do not carry the
 * same weight. A number that came only from /api/ps is a snapshot of one
 * load — usually Ollama's 4,096 default — and nobody may treat it as the
 * settled truth about the model. Only /api/show answers the capability
 * question, and only its answer is worth remembering as final.
 */
export type ContextLengthReading = {
  /** The larger of what answered, or null when neither endpoint did. */
  contextLength: number | null;
  /** True only when /api/show — the capability endpoint — answered. */
  capabilityAnswered: boolean;
};

export async function detectContextLengthReading(
  baseUrl: string,
  modelId: string,
  fetcher: typeof fetch = fetch,
): Promise<ContextLengthReading> {
  const root = normalizeBaseUrl(baseUrl).replace(/\/v1(\/.*)?$/, "");
  if (!root) return { contextLength: null, capabilityAnswered: false };
  const [loaded, capability] = await Promise.all([
    readLoadedContextLength(root, modelId, fetcher),
    readModelContextLength(root, modelId, fetcher),
  ]);
  return {
    contextLength: largerContextLength(loaded, capability),
    capabilityAnswered: capability !== null,
  };
}

/** Just the number, for callers that only ever store it upward. */
export async function detectContextLength(
  baseUrl: string,
  modelId: string,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  return (await detectContextLengthReading(baseUrl, modelId, fetcher)).contextLength;
}

/** The bigger of two readings, either of which may be nothing. */
function largerContextLength(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
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
    // Only the row for this model counts. There is no "whatever is loaded"
    // fallback: a reading taken from another model would be raised into this
    // organization's window and, because the record only ever rises, stay.
    const wanted = modelId.trim();
    if (!wanted) return null;
    const match = models.find((m) => m.name === wanted || m.model === wanted);
    return asContextLength(match?.context_length);
  } catch {
    return null;
  }
}

/**
 * Ollama's /api/show reports the model's own architecture, where the window it
 * can hold is `<architecture>.context_length`. It answers whether or not the
 * model is loaded, and it answers about the model rather than about one load
 * of it — which is why it, not /api/ps, is the one that must not be lost.
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

/**
 * Remember the window for an organization; a no-op when unknown, unchanged,
 * or smaller than what is already recorded.
 *
 * Only ever upward. A reading can be an understatement — /api/ps answering
 * about one load of the model is exactly that — and an understatement that
 * overwrites a known capability pins the organization to it for good.
 */
export async function storeContextLength(db: Db, companyId: string, contextLength: number | null): Promise<void> {
  if (!contextLength) return;
  const rows = await db
    .select({ governance: companies.interactionResolverGovernance })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (rows.length === 0) return;
  const governance = asRecord(rows[0]?.governance);
  const stored = readStoredContextLength(governance);
  if (stored !== null && stored >= contextLength) return;
  await writeContextLength(db, companyId, governance, contextLength, false);
}

/** The one place the two context-window keys are written. */
async function writeContextLength(
  db: Db,
  companyId: string,
  governance: Record<string, unknown>,
  contextLength: number,
  rechecked: boolean,
): Promise<void> {
  await db
    .update(companies)
    .set({
      interactionResolverGovernance: {
        ...governance,
        [CONTEXT_LENGTH_KEY]: contextLength,
        ...(rechecked ? { [CONTEXT_LENGTH_RECHECKED_KEY]: true } : {}),
      } as unknown as (typeof companies.$inferInsert)["interactionResolverGovernance"],
    })
    .where(eq(companies.id, companyId));
}

/**
 * The window for a run's organization: the one a connection test recorded, or
 * — for an agent hired before that was kept, and for a hire whose test ran
 * before the organization existed — a fresh look at the runtime, remembered
 * for next time. Null when nothing can say; the caller must not invent one.
 *
 * A recorded window is not trusted on sight: it may be an understatement
 * written by an earlier, worse reading — every organization backfilled while
 * the model was warm holds 4,096 — so the first run that can reach the
 * runtime asks again and the larger number wins. That check happens once.
 * Once it has happened the answer is the model's own maximum, which does not
 * change between turns, and re-asking every turn would spend two HTTP calls a
 * turn forever on any model smaller than whatever ceiling we compared to. A
 * later connection test (a new model, a new machine) still raises it through
 * `storeContextLength`.
 *
 * "Once" means once the *capability* endpoint answered, not once any number
 * came back. /api/ps answering 4,096 while /api/show was unreachable is the
 * original bug in a new place: it records the load-time default and closes
 * the question, and no amount of healthy runtime afterwards reopens it —
 * only a person re-running a connection test. So the re-checked flag is set
 * by /api/show alone, and a run that only heard from /api/ps stores whatever
 * it raised and asks again next turn.
 */
export async function resolveContextLengthForRun(
  db: Db,
  companyId: string,
  options: {
    baseUrl?: string | null;
    modelId?: string | null;
    detect?: (baseUrl: string, modelId: string) => Promise<ContextLengthReading>;
  } = {},
): Promise<number | null> {
  const rows = await db
    .select({ governance: companies.interactionResolverGovernance })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (rows.length === 0) return null;
  const governance = asRecord(rows[0]?.governance);
  const stored = readStoredContextLength(governance);
  const alreadyRechecked = governance[CONTEXT_LENGTH_RECHECKED_KEY] === true;
  if (stored !== null && alreadyRechecked) return stored;
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
  if (!baseUrl) return stored;
  const detect = options.detect ?? ((url: string, model: string) => detectContextLengthReading(url, model));
  const reading = await detect(baseUrl, typeof options.modelId === "string" ? options.modelId.trim() : "");
  // Nothing answered — the runtime may be down. Nothing was learned, so
  // nothing is recorded and the next run asks again.
  if (reading.contextLength === null) return stored;
  const best = largerContextLength(stored, reading.contextLength) ?? reading.contextLength;
  const rechecked = alreadyRechecked || reading.capabilityAnswered;
  // A loaded-state reading that taught us nothing new is not worth a write,
  // and must not quietly settle the question on its way past.
  if (best === stored && rechecked === alreadyRechecked) return stored;
  await writeContextLength(db, companyId, governance, best, rechecked);
  return best;
}

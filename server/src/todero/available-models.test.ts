import { describe, expect, it, vi } from "vitest";

const mockDetectLocalLlms = vi.hoisted(() => vi.fn());
vi.mock("./local-llm-detect.js", () => ({ detectLocalLlms: mockDetectLocalLlms }));

const {
  detectAvailableModelIds,
  readStoredAvailableModelIds,
  resolveAvailableModelIdsForRun,
  storeAvailableModelIds,
} = await import("./available-models.js");

function fakeDb(input: { governance: unknown; rows?: number }) {
  const updates: Array<Record<string, unknown>> = [];
  const rows = input.rows === 0 ? [] : [{ governance: input.governance }];
  return {
    updates,
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: async () => undefined };
        },
      }),
    } as never,
  };
}

describe("readStoredAvailableModelIds", () => {
  it("reads the list out of the settings blob and drops anything that is not a model id", () => {
    expect(
      readStoredAvailableModelIds({ toderoLocalLlmAvailableModelIds: ["a:14b", "", 7, "b:1b"] }),
    ).toEqual(["a:14b", "b:1b"]);
  });

  it("is empty for an organization that has never had one", () => {
    expect(readStoredAvailableModelIds(null)).toEqual([]);
    expect(readStoredAvailableModelIds({})).toEqual([]);
  });
});

describe("detectAvailableModelIds", () => {
  it("matches the runtime by base URL, including an agent's completions URL", async () => {
    mockDetectLocalLlms.mockResolvedValue({
      runtimes: [
        { baseUrl: "http://127.0.0.1:1234", models: [{ id: "small:1b" }] },
        { baseUrl: "http://127.0.0.1:11434", models: [{ id: "big:14b" }, { id: "fast:1b" }] },
      ],
    });
    await expect(detectAvailableModelIds("http://127.0.0.1:11434")).resolves.toEqual(["big:14b", "fast:1b"]);
    await expect(
      detectAvailableModelIds("http://127.0.0.1:11434/v1/chat/completions"),
    ).resolves.toEqual(["big:14b", "fast:1b"]);
  });

  it("is empty when nothing is listening at that URL", async () => {
    mockDetectLocalLlms.mockResolvedValue({ runtimes: [] });
    await expect(detectAvailableModelIds("http://127.0.0.1:11434")).resolves.toEqual([]);
  });
});

describe("storeAvailableModelIds", () => {
  it("writes the list into the settings blob it already has, keeping the rest", async () => {
    const { db, updates } = fakeDb({ governance: { autoAcceptWhenJudgePasses: true } });
    await expect(storeAvailableModelIds(db, "company-1", ["big:14b"])).resolves.toEqual(["big:14b"]);
    expect(updates).toEqual([
      {
        interactionResolverGovernance: {
          autoAcceptWhenJudgePasses: true,
          toderoLocalLlmAvailableModelIds: ["big:14b"],
        },
      },
    ]);
  });

  it("writes nothing when the list is empty or already stored", async () => {
    const empty = fakeDb({ governance: {} });
    await expect(storeAvailableModelIds(empty.db, "company-1", [])).resolves.toEqual([]);
    expect(empty.updates).toEqual([]);

    const same = fakeDb({ governance: { toderoLocalLlmAvailableModelIds: ["big:14b"] } });
    await expect(storeAvailableModelIds(same.db, "company-1", ["big:14b"])).resolves.toEqual(["big:14b"]);
    expect(same.updates).toEqual([]);
  });
});

describe("resolveAvailableModelIdsForRun", () => {
  it("uses what the organization already has, without looking at the runtime", async () => {
    mockDetectLocalLlms.mockReset();
    const { db, updates } = fakeDb({ governance: { toderoLocalLlmAvailableModelIds: ["big:14b"] } });
    await expect(
      resolveAvailableModelIdsForRun(db, { companyId: "company-1", baseUrl: "http://127.0.0.1:11434" }),
    ).resolves.toEqual(["big:14b"]);
    expect(mockDetectLocalLlms).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  /** An organization hired before this was kept still gets routing. */
  it("looks once at the runtime when nothing is stored, and remembers it", async () => {
    mockDetectLocalLlms.mockReset();
    mockDetectLocalLlms.mockResolvedValue({
      runtimes: [{ baseUrl: "http://127.0.0.1:11434", models: [{ id: "big:14b" }, { id: "fast:1b" }] }],
    });
    const { db, updates } = fakeDb({ governance: {} });
    await expect(
      resolveAvailableModelIdsForRun(db, {
        companyId: "company-1",
        baseUrl: "http://127.0.0.1:11434/v1/chat/completions",
      }),
    ).resolves.toEqual(["big:14b", "fast:1b"]);
    expect(updates).toHaveLength(1);
  });

  it("is empty, and writes nothing, when the runtime is not up", async () => {
    mockDetectLocalLlms.mockReset();
    mockDetectLocalLlms.mockResolvedValue({ runtimes: [] });
    const { db, updates } = fakeDb({ governance: {} });
    await expect(
      resolveAvailableModelIdsForRun(db, { companyId: "company-1", baseUrl: "http://127.0.0.1:11434" }),
    ).resolves.toEqual([]);
    expect(updates).toEqual([]);
  });
});

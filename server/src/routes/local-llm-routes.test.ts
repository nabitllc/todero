import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDetectLocalLlms = vi.hoisted(() => vi.fn());

vi.mock("../todero/local-llm-detect.js", () => ({
  detectLocalLlms: mockDetectLocalLlms,
}));

const mockTestLocalLlmConnection = vi.hoisted(() => vi.fn());

vi.mock("../todero/local-llm-test.js", () => ({
  testLocalLlmConnection: mockTestLocalLlmConnection,
}));

// The served window is asked of the runtime after a passing test; a fixed
// answer keeps this file off the network.
const mockDetectContextLength = vi.hoisted(() => vi.fn(async () => 4096));

vi.mock("../todero/available-models.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../todero/available-models.js")>();
  return { ...actual, detectContextLength: mockDetectContextLength };
});

import { toderoLocalLlmRoutes } from "./local-llm-routes.js";

describe("toderoLocalLlmRoutes", () => {
  beforeEach(() => {
    mockDetectLocalLlms.mockReset();
    mockDetectLocalLlms.mockResolvedValue({ runtimes: [] });
  });

  it("GET /api/todero/local-llm/detect is mounted and does not 404", async () => {
    const app = express();
    app.use("/api", toderoLocalLlmRoutes());
    const res = await request(app).get("/api/todero/local-llm/detect");
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runtimes: [] });
    expect(mockDetectLocalLlms).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/todero/local-llm/test", () => {
  beforeEach(() => {
    mockDetectLocalLlms.mockReset();
    mockDetectLocalLlms.mockResolvedValue({ runtimes: [] });
    mockTestLocalLlmConnection.mockReset();
  });

  it("is mounted, validates its body, and returns the tester's verdict", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", toderoLocalLlmRoutes());

    const missing = await request(app).post("/api/todero/local-llm/test").send({ baseUrl: "http://127.0.0.1:11434" });
    expect(missing.status).toBe(400);

    mockTestLocalLlmConnection.mockResolvedValue({ ok: true, reply: "OK", latencyMs: 12 });
    const ok = await request(app)
      .post("/api/todero/local-llm/test")
      .send({ baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5-coder:latest" });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, reply: "OK", latencyMs: 12, availableModels: [], contextLength: 4096 });
    expect(mockTestLocalLlmConnection).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:11434",
      modelId: "qwen2.5-coder:latest",
    });
  });

  /**
   * Wave J item G: model routing ranks the models this machine serves, so a
   * passing test is where that list gets written down.
   */
  it("reports the models this machine serves and remembers them for the organization", async () => {
    mockTestLocalLlmConnection.mockResolvedValue({ ok: true, reply: "OK", latencyMs: 9 });
    mockDetectLocalLlms.mockResolvedValue({
      runtimes: [
        {
          id: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          models: [{ id: "llama3.2:1b" }, { id: "qwen2.5-coder:14b" }],
        },
      ],
    });
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ governance: {} }] }) }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: async () => undefined };
        },
      }),
    };
    const app = express();
    app.use(express.json());
    app.use("/api", toderoLocalLlmRoutes(db as never));

    const res = await request(app)
      .post("/api/todero/local-llm/test")
      .send({ baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5-coder:14b", companyId: "company-1" });

    expect(res.status).toBe(200);
    expect(res.body.availableModels).toEqual(["llama3.2:1b", "qwen2.5-coder:14b"]);
    expect(res.body.contextLength).toBe(4096);
    expect(updates).toEqual([
      {
        interactionResolverGovernance: {
          toderoLocalLlmAvailableModelIds: ["llama3.2:1b", "qwen2.5-coder:14b"],
        },
      },
      {
        interactionResolverGovernance: {
          toderoLocalLlmContextLength: 4096,
        },
      },
    ]);
  });

  it("remembers nothing when the test does not pass", async () => {
    mockTestLocalLlmConnection.mockResolvedValue({ ok: false, error: "no answer", latencyMs: 30 });
    const updates: unknown[] = [];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ governance: {} }] }) }) }),
      update: () => ({
        set: (values: unknown) => {
          updates.push(values);
          return { where: async () => undefined };
        },
      }),
    };
    const app = express();
    app.use(express.json());
    app.use("/api", toderoLocalLlmRoutes(db as never));

    const res = await request(app)
      .post("/api/todero/local-llm/test")
      .send({ baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5-coder:14b", companyId: "company-1" });

    expect(res.status).toBe(200);
    expect(res.body.availableModels).toEqual([]);
    expect(updates).toEqual([]);
  });
});

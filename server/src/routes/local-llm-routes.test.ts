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
    expect(ok.body).toEqual({ ok: true, reply: "OK", latencyMs: 12 });
    expect(mockTestLocalLlmConnection).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:11434",
      modelId: "qwen2.5-coder:latest",
    });
  });
});

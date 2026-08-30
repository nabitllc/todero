import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDetectLocalLlms = vi.hoisted(() => vi.fn());

vi.mock("../todero/local-llm-detect.js", () => ({
  detectLocalLlms: mockDetectLocalLlms,
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

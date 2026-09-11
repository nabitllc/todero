import { Router } from "express";
import { detectLocalLlms } from "../todero/local-llm-detect.js";
import { testLocalLlmConnection } from "../todero/local-llm-test.js";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function toderoLocalLlmRoutes() {
  const router = Router();

  router.get("/todero/local-llm/detect", async (_req, res) => {
    try {
      const result = await detectLocalLlms();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to detect local LLM runtimes",
      });
    }
  });

  // The wizard's "Test connection": one short completion against the picked
  // model. Always 200 with { ok } so the UI can show the reason on a miss;
  // 400 only when the request itself is malformed.
  router.post("/todero/local-llm/test", async (req, res) => {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const baseUrl = readString(body.baseUrl);
    const modelId = readString(body.modelId);
    if (!baseUrl || !modelId) {
      res.status(400).json({ error: "baseUrl and modelId are required" });
      return;
    }
    try {
      res.json(await testLocalLlmConnection({ baseUrl, modelId }));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to test the local LLM connection",
      });
    }
  });

  return router;
}

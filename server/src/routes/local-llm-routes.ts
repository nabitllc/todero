import { Router } from "express";
import type { Db } from "@todero/db";
import { detectAvailableModelIds, storeAvailableModelIds } from "../todero/available-models.js";
import { detectLocalLlms } from "../todero/local-llm-detect.js";
import { testLocalLlmConnection } from "../todero/local-llm-test.js";
import { logger } from "../middleware/logger.js";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function toderoLocalLlmRoutes(db?: Db) {
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
  // 400 only when the request itself is malformed. A pass also reports every
  // model this machine serves, and remembers it for the organization when the
  // caller names one — that list is what model routing ranks per turn.
  router.post("/todero/local-llm/test", async (req, res) => {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const baseUrl = readString(body.baseUrl);
    const modelId = readString(body.modelId);
    const companyId = readString(body.companyId);
    if (!baseUrl || !modelId) {
      res.status(400).json({ error: "baseUrl and modelId are required" });
      return;
    }
    try {
      const testResult = await testLocalLlmConnection({ baseUrl, modelId });
      const availableModels = testResult.ok ? await detectAvailableModelIds(baseUrl) : [];
      if (db && companyId && availableModels.length > 0) {
        try {
          await storeAvailableModelIds(db, companyId, availableModels);
        } catch (err) {
          logger.warn({ err, companyId }, "failed to remember the available local models for the company");
        }
      }
      res.json({ ...testResult, availableModels });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to test the local LLM connection",
      });
    }
  });

  return router;
}

import { Router } from "express";
import { detectLocalLlms } from "../todero/local-llm-detect.js";

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

  return router;
}

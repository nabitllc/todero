import { Router } from "express";
import {
  applyVaultReadEnv,
  getVaultReadPath,
  getVaultSettings,
  resolveRecommendedVaultPath,
  saveVaultSettings,
  vaultPathExists,
  type VaultSource,
} from "../todero/vault-settings.js";

const SOURCES = new Set<VaultSource>(["recommended", "personal", "none"]);

export function toderoVaultRoutes() {
  const router = Router();

  router.get("/todero/vault", (_req, res) => {
    const settings = getVaultSettings();
    const recommendedPath = resolveRecommendedVaultPath();
    const readPath = getVaultReadPath();
    res.json({
      settings,
      recommendedPath,
      recommendedExists: vaultPathExists(recommendedPath),
      recommendedFromEnv: Boolean(process.env.TODERO_VAULT_DIR?.trim()),
      readPath,
      readPathExists: vaultPathExists(readPath),
      readOnly: true,
    });
  });

  router.put("/todero/vault", (req, res) => {
    const source = req.body?.source as string;
    if (!SOURCES.has(source as VaultSource)) {
      res.status(400).json({ error: "source must be recommended, personal, or none" });
      return;
    }
    try {
      const settings = saveVaultSettings({
        source: source as VaultSource,
        path: typeof req.body?.path === "string" ? req.body.path : null,
      });
      res.json({
        settings,
        readPath: getVaultReadPath(),
        readPathExists: vaultPathExists(getVaultReadPath()),
        readOnly: true,
        heartbeatEnv: applyVaultReadEnv({}),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}

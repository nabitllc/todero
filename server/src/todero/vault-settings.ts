import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export const DEFAULT_RECOMMENDED_VAULT_PATH = "/workspace/Mich-Brain2";

export type VaultSource = "recommended" | "personal" | "none";

export type VaultSettingsRow = {
  id: 1;
  source: VaultSource;
  path: string | null;
  updatedAt: string;
};

function settingsDir(): string {
  const override = process.env.TODERO_SETTINGS_DIR?.trim();
  return override && override.length > 0 ? override : path.join(os.homedir(), ".todero");
}

function jsonPath(): string {
  return path.join(settingsDir(), "vault-settings.json");
}

function sqlitePath(): string {
  return path.join(settingsDir(), "vault-settings.sqlite");
}

export function resolveRecommendedVaultPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.TODERO_VAULT_DIR?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_RECOMMENDED_VAULT_PATH;
}

function ensureSettingsDir(): void {
  // Settings dir only — never the vault.
  fs.mkdirSync(settingsDir(), { recursive: true });
}

function openSqlite(): { exec: (sql: string) => void; prepare: (sql: string) => { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => void } } | null {
  try {
    // Node 22+/24 DatabaseSync. Optional — JSON is the fallback row store.
    const mod = require("node:sqlite") as { DatabaseSync: new (p: string) => any };
    const db = new mod.DatabaseSync(sqlitePath());
    db.exec(`CREATE TABLE IF NOT EXISTS vault_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      source TEXT NOT NULL,
      path TEXT,
      updated_at TEXT NOT NULL
    )`);
    return db;
  } catch {
    return null;
  }
}

function rowFromUnknown(raw: unknown): VaultSettingsRow | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const source = rec.source;
  if (source !== "recommended" && source !== "personal" && source !== "none") return null;
  const p = rec.path;
  return {
    id: 1,
    source,
    path: typeof p === "string" && p.trim() ? p.trim() : null,
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : typeof rec.updated_at === "string" ? rec.updated_at : new Date().toISOString(),
  };
}

export function getVaultSettings(): VaultSettingsRow | null {
  const db = openSqlite();
  if (db) {
    try {
      const got = db.prepare("SELECT id, source, path, updated_at FROM vault_settings WHERE id = 1").get() as
        | { source?: string; path?: string | null; updated_at?: string }
        | undefined;
      if (got) {
        return rowFromUnknown({ source: got.source, path: got.path, updated_at: got.updated_at });
      }
    } catch {
      // fall through to JSON
    }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath(), "utf8"));
    return rowFromUnknown(raw);
  } catch {
    return null;
  }
}

export function saveVaultSettings(input: { source: VaultSource; path?: string | null }): VaultSettingsRow {
  let storedPath: string | null = null;
  if (input.source === "recommended") {
    storedPath = resolveRecommendedVaultPath();
  } else if (input.source === "personal") {
    const p = input.path?.trim() ?? "";
    if (!p) {
      throw new Error("Personal Second Brain requires a path.");
    }
    if (!path.isAbsolute(p)) {
      throw new Error("Personal Second Brain path must be absolute.");
    }
    storedPath = p;
  } else {
    storedPath = null;
  }

  const row: VaultSettingsRow = {
    id: 1,
    source: input.source,
    path: storedPath,
    updatedAt: new Date().toISOString(),
  };

  ensureSettingsDir();

  const db = openSqlite();
  if (db) {
    db.prepare(
      "INSERT INTO vault_settings (id, source, path, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source = excluded.source, path = excluded.path, updated_at = excluded.updated_at",
    ).run(row.source, row.path, row.updatedAt);
  }
  fs.writeFileSync(jsonPath(), `${JSON.stringify(row, null, 2)}\n`, "utf8");
  return row;
}

/**
 * Path heartbeat/read must use. Comes from the persisted row, not env alone.
 * Env only seeds the Recommended default when the user picks Recommended.
 */
export function getVaultReadPath(): string | null {
  const row = getVaultSettings();
  if (!row || row.source === "none") return null;
  return row.path;
}

export function vaultPathExists(vaultPath: string | null): boolean {
  if (!vaultPath) return false;
  try {
    return fs.existsSync(vaultPath);
  } catch {
    return false;
  }
}

/** Read-only file access. Never mkdir. Never write the vault. */
export function readVaultFile(relativePath: string): string {
  const root = getVaultReadPath();
  if (!root) {
    throw new Error("No Second Brain is configured.");
  }
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, relativePath);
  const rel = path.relative(resolvedRoot, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Vault path escapes the configured Second Brain.");
  }
  return fs.readFileSync(full, "utf8");
}

export function applyVaultReadEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const row = getVaultSettings();
  const next = { ...base };
  if (row && row.source !== "none" && row.path) {
    next.TODERO_VAULT_DIR = row.path;
    next.TODERO_VAULT_SOURCE = row.source;
    next.TODERO_VAULT_READONLY = "1";
  } else {
    delete next.TODERO_VAULT_DIR;
    next.TODERO_VAULT_SOURCE = "none";
    next.TODERO_VAULT_READONLY = "1";
  }
  return next;
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDatabaseTarget } from "./runtime-config.js";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ENV = { ...process.env };

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeText(filePath: string, value: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveDatabaseTarget", () => {
  it("uses DATABASE_URL from process env first", () => {
    process.env.DATABASE_URL = "postgres://env-user:env-pass@db.example.com:5432/todero";

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "postgres",
      connectionString: "postgres://env-user:env-pass@db.example.com:5432/todero",
      source: "DATABASE_URL",
    });
  });

  it("uses DATABASE_URL from repo-local .todero/.env", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "todero-db-runtime-"));
    const projectDir = path.join(tempDir, "repo");
    fs.mkdirSync(projectDir, { recursive: true });
    process.chdir(projectDir);
    delete process.env.PAPERCLIP_CONFIG;
    writeJson(path.join(projectDir, ".todero", "config.json"), {
      database: { mode: "embedded-postgres", embeddedPostgresPort: 54329 },
    });
    writeText(
      path.join(projectDir, ".todero", ".env"),
      'DATABASE_URL="postgres://file-user:file-pass@db.example.com:6543/todero"\n',
    );

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "postgres",
      connectionString: "postgres://file-user:file-pass@db.example.com:6543/todero",
      source: "todero-env",
    });
  });

  it("uses config postgres connection string when configured", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "todero-db-runtime-"));
    const configPath = path.join(tempDir, "instance", "config.json");
    process.env.PAPERCLIP_CONFIG = configPath;
    writeJson(configPath, {
      database: {
        mode: "postgres",
        connectionString: "postgres://cfg-user:cfg-pass@db.example.com:5432/todero",
      },
    });

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "postgres",
      connectionString: "postgres://cfg-user:cfg-pass@db.example.com:5432/todero",
      source: "config.database.connectionString",
    });
  });

  it("falls back to embedded postgres settings from config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "todero-db-runtime-"));
    const configPath = path.join(tempDir, "instance", "config.json");
    process.env.PAPERCLIP_CONFIG = configPath;
    writeJson(configPath, {
      database: {
        mode: "embedded-postgres",
        embeddedPostgresDataDir: "~/todero-test-db",
        embeddedPostgresPort: 55444,
      },
    });

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "embedded-postgres",
      dataDir: path.resolve(os.homedir(), "todero-test-db"),
      port: 55444,
      source: "embedded-postgres@55444",
    });
  });

  it("uses the instance root for a fresh default embedded postgres target", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "todero-db-home-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "todero-db-cwd-"));
    process.chdir(cwd);
    process.env.PAPERCLIP_HOME = home;
    delete process.env.PAPERCLIP_CONFIG;
    delete process.env.PAPERCLIP_INSTANCE_ID;
    delete process.env.DATABASE_URL;

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "embedded-postgres",
      dataDir: path.join(home, "instances", "default", "db"),
      port: 54329,
      source: "embedded-postgres@54329",
      configPath: path.join(home, "instances", "default", "config.json"),
      envPath: path.join(home, "instances", "default", ".env"),
    });
  });
});

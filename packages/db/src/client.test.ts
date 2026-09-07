import { createHash } from "node:crypto";
import fs from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import {
  applyPendingMigrations,
  inspectMigrations,
  reconcilePendingMigrationHistory,
  resetPostgresDatabase,
  splitMigrationStatements,
  statementContainsMultipleTopLevelStatements,
  __migrationStatementAlreadyAppliedForTests,
} from "./client.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createTempDatabase(): Promise<string> {
  const db = await startEmbeddedPostgresTestDatabase("todero-db-client-");
  cleanups.push(db.cleanup);
  return db.connectionString;
}

async function migrationHash(migrationFile: string): Promise<string> {
  const content = await fs.promises.readFile(
    new URL(`./migrations/${migrationFile}`, import.meta.url),
    "utf8",
  );
  return createHash("sha256").update(content).digest("hex");
}

const userVisibleUpdatedAtTables = new Set([
  "companies",
  "heartbeat_runs",
  "issue_comments",
  "issues",
  "routine_runs",
  "routines",
]);

const migrationUpdatedAtUpdateAllowlist = new Map<string, ReadonlySet<string>>([
  [
    "0105_instance_scoped_environments.sql",
    new Set(["issues"]),
  ],
  [
    "0131_repair_run_responsible_user_context_refs.sql",
    new Set(["heartbeat_runs"]),
  ],
  [
    "0135_repair_run_responsible_user_updated_at_sweep.sql",
    new Set(["companies", "heartbeat_runs", "issues", "routine_runs", "routines"]),
  ],
]);

function findUserVisibleUpdatedAtBackfillViolations(
  migrationFile: string,
  content: string,
): string[] {
  const allowedTables = migrationUpdatedAtUpdateAllowlist.get(migrationFile) ?? new Set<string>();
  const violations: string[] = [];

  for (const statement of content.split("--> statement-breakpoint")) {
    const updateMatch = statement.match(/\bUPDATE\s+"([^"]+)"/i);
    if (!updateMatch) continue;

    const tableName = updateMatch[1];
    if (!userVisibleUpdatedAtTables.has(tableName)) continue;
    if (!/\bSET\b[\s\S]*"updated_at"\s*=/i.test(statement)) continue;
    if (allowedTables.has(tableName)) continue;

    violations.push(`${migrationFile}: UPDATE "${tableName}" sets updated_at`);
  }

  return violations;
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres migration tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("resetPostgresDatabase", () => {
  it("recreates an existing database so stale tables are removed", async () => {
    const connectionString = await createTempDatabase();
    const adminUrl = new URL(connectionString);
    const databaseName = adminUrl.pathname.replace(/^\//, "");
    adminUrl.pathname = "/postgres";

    const setupSql = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      await setupSql.unsafe(`CREATE TABLE stale_reseed_target_only (id integer PRIMARY KEY)`);
    } finally {
      await setupSql.end();
    }

    await resetPostgresDatabase(adminUrl.toString(), databaseName);

    const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      const rows = await verifySql.unsafe<{ stale_table: string | null }[]>(
        `SELECT to_regclass('public.stale_reseed_target_only')::text AS stale_table`,
      );
      expect(rows[0]?.stale_table).toBeNull();
    } finally {
      await verifySql.end();
    }
  }, 30_000);
});

describeEmbeddedPostgres("applyPendingMigrations", () => {
  it("rejects unallowlisted migration backfills that bump updated_at on user-visible tables", async () => {
    const entries = await fs.promises.readdir(new URL("./migrations", import.meta.url), {
      withFileTypes: true,
    });
    const violations: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
      const content = await fs.promises.readFile(
        new URL(`./migrations/${entry.name}`, import.meta.url),
        "utf8",
      );
      violations.push(...findUserVisibleUpdatedAtBackfillViolations(entry.name, content));
    }

    expect(violations).toEqual([]);
    expect(
      findUserVisibleUpdatedAtBackfillViolations(
        "9999_bad_backfill.sql",
        `
          UPDATE "issues" AS i
          SET "responsible_user_id" = 'owner-user',
              "updated_at" = now()
          WHERE i."responsible_user_id" IS NULL;
        `,
      ),
    ).toEqual(['9999_bad_backfill.sql: UPDATE "issues" sets updated_at']);
  });

  it(
    "applies an inserted earlier migration without replaying later legacy migrations",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const richMagnetoHash = await migrationHash("0030_rich_magneto.sql");

        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${richMagnetoHash}'`,
        );
        await sql.unsafe(`DROP TABLE "company_logos"`);
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0030_rich_magneto.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const rows = await verifySql.unsafe<{ table_name: string }[]>(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('company_logos', 'execution_workspaces')
            ORDER BY table_name
          `,
        );
        expect(rows.map((row) => row.table_name)).toEqual([
          "company_logos",
          "execution_workspaces",
        ]);
      } finally {
        await verifySql.end();
      }
    },
    20_000,
  );

  it(
    "replays migration 0044 safely when its schema changes already exist",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const illegalToadHash = await migrationHash("0044_illegal_toad.sql");

        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${illegalToadHash}'`,
        );

        const columns = await sql.unsafe<{ column_name: string }[]>(
          `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'instance_settings'
              AND column_name = 'general'
          `,
        );
        expect(columns).toHaveLength(1);
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0044_illegal_toad.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");
    },
    20_000,
  );

  it(
    "enforces a unique board_api_keys.key_hash after migration 0044",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(`
          INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
          VALUES ('user-1', 'User One', 'user@example.com', true, now(), now())
        `);
        await sql.unsafe(`
          INSERT INTO "board_api_keys" ("id", "user_id", "name", "key_hash", "created_at")
          VALUES ('00000000-0000-0000-0000-000000000001', 'user-1', 'Key One', 'dup-hash', now())
        `);
        await expect(
          sql.unsafe(`
            INSERT INTO "board_api_keys" ("id", "user_id", "name", "key_hash", "created_at")
            VALUES ('00000000-0000-0000-0000-000000000002', 'user-1', 'Key Two', 'dup-hash', now())
          `),
        ).rejects.toThrow();
      } finally {
        await sql.end();
      }
    },
    20_000,
  );

  it(
    "replays migration 0046 safely when document revision columns already exist",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const smoothSentinelsHash = await migrationHash("0046_smooth_sentinels.sql");

        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${smoothSentinelsHash}'`,
        );

        const columns = await sql.unsafe<{ column_name: string; is_nullable: string; column_default: string | null }[]>(
          `
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'document_revisions'
              AND column_name IN ('title', 'format')
            ORDER BY column_name
          `,
        );
        expect(columns).toHaveLength(2);
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0046_smooth_sentinels.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const columns = await verifySql.unsafe<{ column_name: string; is_nullable: string; column_default: string | null }[]>(
          `
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'document_revisions'
              AND column_name IN ('title', 'format')
            ORDER BY column_name
          `,
        );
        expect(columns).toEqual([
          expect.objectContaining({
            column_name: "format",
            is_nullable: "NO",
          }),
          expect.objectContaining({
            column_name: "title",
            is_nullable: "YES",
          }),
        ]);
        expect(columns[0]?.column_default).toContain("'markdown'");
      } finally {
        await verifySql.end();
      }
    },
    20_000,
  );

  it(
    "replays migration 0047 safely when feedback tables and run columns already exist",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const overjoyedGrootHash = await migrationHash("0047_overjoyed_groot.sql");

        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${overjoyedGrootHash}'`,
        );

        const tables = await sql.unsafe<{ table_name: string }[]>(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('feedback_exports', 'feedback_votes')
            ORDER BY table_name
          `,
        );
        expect(tables.map((row) => row.table_name)).toEqual([
          "feedback_exports",
          "feedback_votes",
        ]);

        const columns = await sql.unsafe<{ table_name: string; column_name: string }[]>(
          `
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (
                (table_name = 'companies' AND column_name IN (
                  'feedback_data_sharing_enabled',
                  'feedback_data_sharing_consent_at',
                  'feedback_data_sharing_consent_by_user_id',
                  'feedback_data_sharing_terms_version'
                ))
                OR (table_name = 'document_revisions' AND column_name = 'created_by_run_id')
                OR (table_name = 'issue_comments' AND column_name = 'created_by_run_id')
              )
            ORDER BY table_name, column_name
          `,
        );
        expect(columns).toHaveLength(6);
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0047_overjoyed_groot.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const constraints = await verifySql.unsafe<{ conname: string }[]>(
          `
            SELECT conname
            FROM pg_constraint
            WHERE conname IN (
              'feedback_exports_company_id_companies_id_fk',
              'feedback_exports_feedback_vote_id_feedback_votes_id_fk',
              'feedback_exports_issue_id_issues_id_fk',
              'feedback_votes_company_id_companies_id_fk',
              'feedback_votes_issue_id_issues_id_fk'
            )
            ORDER BY conname
          `,
        );
        expect(constraints.map((row) => row.conname)).toEqual([
          "feedback_exports_company_id_companies_id_fk",
          "feedback_exports_feedback_vote_id_feedback_votes_id_fk",
          "feedback_exports_issue_id_issues_id_fk",
          "feedback_votes_company_id_companies_id_fk",
          "feedback_votes_issue_id_issues_id_fk",
        ]);
      } finally {
        await verifySql.end();
      }
    },
    20_000,
  );

  it(
    "replays migration 0048 safely when routines.variables already exists",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const flashyMarrowHash = await migrationHash("0048_flashy_marrow.sql");

        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${flashyMarrowHash}'`,
        );

        const columns = await sql.unsafe<{ column_name: string }[]>(
          `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'routines'
              AND column_name = 'variables'
          `,
        );
        expect(columns).toHaveLength(1);
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0048_flashy_marrow.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const columns = await verifySql.unsafe<{ column_name: string; is_nullable: string; data_type: string }[]>(
          `
            SELECT column_name, is_nullable, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'routines'
              AND column_name = 'variables'
          `,
        );
        expect(columns).toEqual([
          expect.objectContaining({
            column_name: "variables",
            is_nullable: "NO",
            data_type: "jsonb",
          }),
        ]);
      } finally {
        await verifySql.end();
      }
    },
    20_000,
  );

  it(
    "replays migration 0050 safely when projects.env already exists",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const stiffLuckmanHash = await migrationHash("0050_stiff_luckman.sql");

        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${stiffLuckmanHash}'`,
        );

        const columns = await sql.unsafe<{ column_name: string }[]>(
          `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'projects'
              AND column_name = 'env'
          `,
        );
        expect(columns).toHaveLength(1);
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0050_stiff_luckman.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const columns = await verifySql.unsafe<{ column_name: string; is_nullable: string; data_type: string }[]>(
          `
            SELECT column_name, is_nullable, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'projects'
              AND column_name = 'env'
          `,
        );
        expect(columns).toEqual([
          expect.objectContaining({
            column_name: "env",
            is_nullable: "YES",
            data_type: "jsonb",
          }),
        ]);
      } finally {
        await verifySql.end();
      }
    },
    20_000,
  );

  it(
    "replays migration 0059 safely when plugin_database_namespaces already exists",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const pluginNamespacesHash = await migrationHash(
          "0059_plugin_database_namespaces.sql",
        );

        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${pluginNamespacesHash}'`,
        );

        const tables = await sql.unsafe<{ table_name: string }[]>(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('plugin_database_namespaces', 'plugin_migrations')
            ORDER BY table_name
          `,
        );
        expect(tables.map((row) => row.table_name)).toEqual([
          "plugin_database_namespaces",
          "plugin_migrations",
        ]);
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0059_plugin_database_namespaces.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const indexes = await verifySql.unsafe<{ indexname: string }[]>(
          `
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename IN ('plugin_database_namespaces', 'plugin_migrations')
            ORDER BY indexname
          `,
        );
        expect(indexes.map((row) => row.indexname)).toEqual(
          expect.arrayContaining([
            "plugin_database_namespaces_namespace_idx",
            "plugin_database_namespaces_plugin_idx",
            "plugin_database_namespaces_status_idx",
            "plugin_migrations_plugin_idx",
            "plugin_migrations_plugin_key_idx",
            "plugin_migrations_status_idx",
          ]),
        );
      } finally {
        await verifySql.end();
      }
    },
    20_000,
  );

  it(
    "replays the built-in managed resources migration after the legacy 0136 journal entry",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const builtInResourcesHash = await migrationHash(
        "0140_built_in_managed_resources.sql",
      );
      const legacyBuiltInResourcesHash = createHash("sha256")
        .update("legacy 0136_built_in_managed_resources.sql")
        .digest("hex");

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${builtInResourcesHash}'`,
        );
        await sql.unsafe(
          `
            INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
            VALUES ('${legacyBuiltInResourcesHash}', 1783555200000)
          `,
        );
        await sql.unsafe(`
          ALTER TABLE "built_in_managed_resources"
          DROP CONSTRAINT IF EXISTS "built_in_managed_resources_company_id_companies_id_fk"
        `);
        await sql.unsafe(`DROP INDEX IF EXISTS "built_in_managed_resources_company_idx"`);
        await sql.unsafe(`DROP INDEX IF EXISTS "built_in_managed_resources_resource_idx"`);
        await sql.unsafe(`DROP INDEX IF EXISTS "built_in_managed_resources_company_bundle_resource_uq"`);
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0140_built_in_managed_resources.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const rows = await verifySql.unsafe<{
          foreign_key_exists: boolean;
          company_index_exists: boolean;
          resource_index_exists: boolean;
          unique_index_exists: boolean;
        }[]>(`
          SELECT
            EXISTS (
              SELECT 1
              FROM "pg_constraint" c
              JOIN "pg_class" t ON t.oid = c.conrelid
              JOIN "pg_namespace" n ON n.oid = t.relnamespace
              WHERE n.nspname = 'public'
                AND t.relname = 'built_in_managed_resources'
                AND c.conname = 'built_in_managed_resources_company_id_companies_id_fk'
            ) AS "foreign_key_exists",
            EXISTS (
              SELECT 1
              FROM "pg_class" c
              JOIN "pg_namespace" n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind = 'i'
                AND c.relname = 'built_in_managed_resources_company_idx'
            ) AS "company_index_exists",
            EXISTS (
              SELECT 1
              FROM "pg_class" c
              JOIN "pg_namespace" n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind = 'i'
                AND c.relname = 'built_in_managed_resources_resource_idx'
            ) AS "resource_index_exists",
            EXISTS (
              SELECT 1
              FROM "pg_class" c
              JOIN "pg_namespace" n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind = 'i'
                AND c.relname = 'built_in_managed_resources_company_bundle_resource_uq'
            ) AS "unique_index_exists"
        `);
        expect(rows[0]).toEqual({
          foreign_key_exists: true,
          company_index_exists: true,
          resource_index_exists: true,
          unique_index_exists: true,
        });
      } finally {
        await verifySql.end();
      }
    },
    20_000,
  );

  it(
    "replays migration 0134 without bumping issue updated_at for inbox archives",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const runResponsibleUserHash = await migrationHash(
          "0134_run_responsible_user_invariant.sql",
        );

        await sql.unsafe(`
          INSERT INTO "companies" ("id", "name", "issue_prefix", "created_at", "updated_at")
          VALUES (
            '00000000-0000-0000-0000-000000000120',
            'Migration Inbox Co',
            'TST120',
            '2026-03-26T09:00:00.000Z',
            '2026-03-26T09:00:00.000Z'
          )
        `);
        await sql.unsafe(`
          INSERT INTO "company_memberships" (
            "id",
            "company_id",
            "principal_type",
            "principal_id",
            "status",
            "membership_role",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000121',
            '00000000-0000-0000-0000-000000000120',
            'user',
            'owner-user',
            'active',
            'owner',
            '2026-03-26T09:00:00.000Z',
            '2026-03-26T09:00:00.000Z'
          )
        `);
        await sql.unsafe(`
          INSERT INTO "issues" (
            "id",
            "company_id",
            "title",
            "status",
            "responsible_user_id",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000122',
            '00000000-0000-0000-0000-000000000120',
            'Archived issue needing responsible user backfill',
            'todo',
            NULL,
            '2026-03-26T10:00:00.000Z',
            '2026-03-26T10:00:00.000Z'
          )
        `);
        await sql.unsafe(`
          INSERT INTO "issue_inbox_archives" (
            "id",
            "company_id",
            "issue_id",
            "user_id",
            "archived_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000123',
            '00000000-0000-0000-0000-000000000120',
            '00000000-0000-0000-0000-000000000122',
            'owner-user',
            '2026-03-26T12:00:00.000Z',
            '2026-03-26T12:00:00.000Z',
            '2026-03-26T12:00:00.000Z'
          )
        `);
        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${runResponsibleUserHash}'`,
        );
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0134_run_responsible_user_invariant.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const rows = await verifySql.unsafe<{
          responsible_user_id: string | null;
          updated_at: Date;
          inbox_archive_still_current: boolean;
        }[]>(`
          SELECT
            i."responsible_user_id",
            i."updated_at",
            EXISTS (
              SELECT 1
              FROM "issue_inbox_archives" AS archive
              WHERE archive."company_id" = i."company_id"
                AND archive."issue_id" = i."id"
                AND archive."user_id" = 'owner-user'
                AND archive."archived_at" >= i."updated_at"
            ) AS "inbox_archive_still_current"
          FROM "issues" AS i
          WHERE i."id" = '00000000-0000-0000-0000-000000000122'
        `);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.responsible_user_id).toBe("owner-user");
        expect(rows[0]?.updated_at.toISOString()).toBe("2026-03-26T10:00:00.000Z");
        expect(rows[0]?.inbox_archive_still_current).toBe(true);
      } finally {
        await verifySql.end();
      }
    },
    20_000,
  );

  it(
    "replays migration 0135 to repair updated_at sweeps and no-op when clean",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const repairSweepHash = await migrationHash(
        "0135_repair_run_responsible_user_updated_at_sweep.sql",
      );
      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(`
          INSERT INTO "companies" ("id", "name", "issue_prefix", "created_at", "updated_at")
          VALUES (
            '00000000-0000-0000-0000-000000000240',
            'Clean Migration Co',
            'CLN134',
            '2026-04-01T09:00:00.000Z',
            '2026-04-02T09:00:00.000Z'
          )
        `);
        await sql.unsafe(`
          INSERT INTO "issues" ("id", "company_id", "title", "status", "created_at", "updated_at")
          VALUES (
            '00000000-0000-0000-0000-000000000241',
            '00000000-0000-0000-0000-000000000240',
            'Clean issue should not be touched',
            'todo',
            '2026-04-01T10:00:00.000Z',
            '2026-04-02T10:00:00.000Z'
          )
        `);
        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${repairSweepHash}'`,
        );
      } finally {
        await sql.end();
      }

      await applyPendingMigrations(connectionString);

      const afterCleanReplay = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const cleanRows = await afterCleanReplay.unsafe<{ updated_at: Date }[]>(`
          SELECT "updated_at"
          FROM "issues"
          WHERE "id" = '00000000-0000-0000-0000-000000000241'
        `);
        expect(cleanRows[0]?.updated_at.toISOString()).toBe("2026-04-02T10:00:00.000Z");

        await afterCleanReplay.unsafe(`
          INSERT INTO "companies" ("id", "name", "issue_prefix", "created_at", "updated_at")
          VALUES (
            '00000000-0000-0000-0000-000000000250',
            'Sweep Migration Co',
            'SWP134',
            '2026-01-01T00:00:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "agents" ("id", "company_id", "name", "role", "adapter_type", "created_at", "updated_at")
          VALUES (
            '00000000-0000-0000-0000-000000000251',
            '00000000-0000-0000-0000-000000000250',
            'Sweep Agent',
            'general',
            'process',
            '2026-01-02T00:00:00.000Z',
            '2026-01-02T00:00:00.000Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "issues" ("id", "company_id", "title", "status", "created_at", "updated_at")
          SELECT
            ('10000000-0000-0000-0000-' || lpad(gs::text, 12, '0'))::uuid,
            '00000000-0000-0000-0000-000000000250',
            'Swept issue ' || gs::text,
            'todo',
            '2026-02-01T00:00:00.000Z'::timestamptz + (gs::text || ' minutes')::interval,
            '2026-04-03T12:00:00.123456Z'
          FROM generate_series(1, 101) AS gs
        `);
        await afterCleanReplay.unsafe(`
          UPDATE "issues"
          SET
            "status" = 'done',
            "completed_at" = '2026-04-03T12:00:00.123456Z'
          WHERE "id" = '10000000-0000-0000-0000-000000000003'
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "issue_comments" ("id", "company_id", "issue_id", "body", "created_at", "updated_at")
          VALUES (
            '00000000-0000-0000-0000-000000000252',
            '00000000-0000-0000-0000-000000000250',
            '10000000-0000-0000-0000-000000000001',
            'Latest pre-sweep activity',
            '2026-03-01T15:30:00.000Z',
            '2026-03-02T16:45:00.000Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "heartbeat_runs" (
            "id",
            "company_id",
            "agent_id",
            "status",
            "started_at",
            "finished_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000253',
            '00000000-0000-0000-0000-000000000250',
            '00000000-0000-0000-0000-000000000251',
            'completed',
            '2026-02-10T10:00:00.000Z',
            '2026-02-10T10:30:00.000Z',
            '2026-02-10T09:55:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "heartbeat_runs" (
            "id",
            "company_id",
            "agent_id",
            "status",
            "started_at",
            "last_output_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000256',
            '00000000-0000-0000-0000-000000000250',
            '00000000-0000-0000-0000-000000000251',
            'running',
            '2026-02-10T11:00:00.000Z',
            '2026-04-03T12:00:00.123456Z',
            '2026-02-10T10:55:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "routines" (
            "id",
            "company_id",
            "title",
            "last_triggered_at",
            "last_enqueued_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000254',
            '00000000-0000-0000-0000-000000000250',
            'Swept routine',
            '2026-03-20T10:00:00.000Z',
            '2026-03-21T11:00:00.000Z',
            '2026-02-11T00:00:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "routines" (
            "id",
            "company_id",
            "title",
            "last_triggered_at",
            "last_enqueued_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000257',
            '00000000-0000-0000-0000-000000000250',
            'Same-timestamp active routine',
            '2026-03-20T10:00:00.000Z',
            '2026-04-03T12:00:00.123456Z',
            '2026-02-11T00:00:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "routine_runs" (
            "id",
            "company_id",
            "routine_id",
            "source",
            "status",
            "completed_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000255',
            '00000000-0000-0000-0000-000000000250',
            '00000000-0000-0000-0000-000000000254',
            'schedule',
            'completed',
            '2026-02-12T12:00:00.000Z',
            '2026-02-12T11:00:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "routine_runs" (
            "id",
            "company_id",
            "routine_id",
            "source",
            "status",
            "triggered_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000258',
            '00000000-0000-0000-0000-000000000250',
            '00000000-0000-0000-0000-000000000257',
            'schedule',
            'running',
            '2026-04-03T12:00:00.123456Z',
            '2026-02-12T13:00:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "companies" ("id", "name", "issue_prefix", "created_at", "updated_at")
          VALUES (
            '00000000-0000-0000-0000-000000000260',
            'Coincident Timestamp Co',
            'CTS134',
            '2026-01-05T00:00:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "agents" ("id", "company_id", "name", "role", "adapter_type", "created_at", "updated_at")
          VALUES (
            '00000000-0000-0000-0000-000000000261',
            '00000000-0000-0000-0000-000000000260',
            'Coincident Agent',
            'general',
            'process',
            '2026-01-05T00:10:00.000Z',
            '2026-01-05T00:10:00.000Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "issues" ("id", "company_id", "title", "status", "created_at", "updated_at")
          VALUES (
            '20000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000260',
            'Coincident timestamp issue should not be touched',
            'todo',
            '2026-02-05T00:00:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(`
          INSERT INTO "heartbeat_runs" (
            "id",
            "company_id",
            "agent_id",
            "status",
            "started_at",
            "finished_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000262',
            '00000000-0000-0000-0000-000000000260',
            '00000000-0000-0000-0000-000000000261',
            'completed',
            '2026-02-05T10:00:00.000Z',
            '2026-02-05T10:30:00.000Z',
            '2026-02-05T09:55:00.000Z',
            '2026-04-03T12:00:00.123456Z'
          )
        `);
        await afterCleanReplay.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${repairSweepHash}'`,
        );
      } finally {
        await afterCleanReplay.end();
      }

      await applyPendingMigrations(connectionString);

      const afterRepair = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const repairedRows = await afterRepair.unsafe<{
          subject: string;
          updated_at: Date;
        }[]>(`
          SELECT 'company' AS subject, "updated_at"
          FROM "companies"
          WHERE "id" = '00000000-0000-0000-0000-000000000250'
          UNION ALL
          SELECT 'issue_with_comment' AS subject, "updated_at"
          FROM "issues"
          WHERE "id" = '10000000-0000-0000-0000-000000000001'
          UNION ALL
          SELECT 'issue_without_comment' AS subject, "updated_at"
          FROM "issues"
          WHERE "id" = '10000000-0000-0000-0000-000000000002'
          UNION ALL
          SELECT 'issue_with_state_activity' AS subject, "updated_at"
          FROM "issues"
          WHERE "id" = '10000000-0000-0000-0000-000000000003'
          UNION ALL
          SELECT 'heartbeat_run' AS subject, "updated_at"
          FROM "heartbeat_runs"
          WHERE "id" = '00000000-0000-0000-0000-000000000253'
          UNION ALL
          SELECT 'heartbeat_run_with_output' AS subject, "updated_at"
          FROM "heartbeat_runs"
          WHERE "id" = '00000000-0000-0000-0000-000000000256'
          UNION ALL
          SELECT 'other_company' AS subject, "updated_at"
          FROM "companies"
          WHERE "id" = '00000000-0000-0000-0000-000000000260'
          UNION ALL
          SELECT 'other_heartbeat_run' AS subject, "updated_at"
          FROM "heartbeat_runs"
          WHERE "id" = '00000000-0000-0000-0000-000000000262'
          UNION ALL
          SELECT 'other_issue' AS subject, "updated_at"
          FROM "issues"
          WHERE "id" = '20000000-0000-0000-0000-000000000001'
          UNION ALL
          SELECT 'routine' AS subject, "updated_at"
          FROM "routines"
          WHERE "id" = '00000000-0000-0000-0000-000000000254'
          UNION ALL
          SELECT 'routine_with_activity' AS subject, "updated_at"
          FROM "routines"
          WHERE "id" = '00000000-0000-0000-0000-000000000257'
          UNION ALL
          SELECT 'routine_run' AS subject, "updated_at"
          FROM "routine_runs"
          WHERE "id" = '00000000-0000-0000-0000-000000000255'
          UNION ALL
          SELECT 'routine_run_with_trigger' AS subject, "updated_at"
          FROM "routine_runs"
          WHERE "id" = '00000000-0000-0000-0000-000000000258'
          ORDER BY subject
        `);
        const repaired = Object.fromEntries(
          repairedRows.map((row) => [row.subject, row.updated_at.toISOString()]),
        );
        expect(repaired).toEqual({
          company: "2026-01-01T00:00:00.000Z",
          heartbeat_run: "2026-02-10T10:30:00.000Z",
          heartbeat_run_with_output: "2026-04-03T12:00:00.123Z",
          issue_with_comment: "2026-03-02T16:45:00.000Z",
          issue_with_state_activity: "2026-04-03T12:00:00.123Z",
          issue_without_comment: "2026-02-01T00:02:00.000Z",
          other_company: "2026-04-03T12:00:00.123Z",
          other_heartbeat_run: "2026-04-03T12:00:00.123Z",
          other_issue: "2026-04-03T12:00:00.123Z",
          routine: "2026-03-21T11:00:00.000Z",
          routine_run_with_trigger: "2026-04-03T12:00:00.123Z",
          routine_with_activity: "2026-04-03T12:00:00.123Z",
          routine_run: "2026-02-12T12:00:00.000Z",
        });

        await afterRepair.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${repairSweepHash}'`,
        );
      } finally {
        await afterRepair.end();
      }

      await applyPendingMigrations(connectionString);

      const afterSecondRun = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const secondRunRows = await afterSecondRun.unsafe<{ updated_at: Date }[]>(`
          SELECT "updated_at"
          FROM "issues"
          WHERE "id" = '10000000-0000-0000-0000-000000000001'
        `);
        expect(secondRunRows[0]?.updated_at.toISOString()).toBe("2026-03-02T16:45:00.000Z");
      } finally {
        await afterSecondRun.end();
      }
    },
    20_000,
  );

  it(
    "replays the run responsible user repair migration when heartbeat run issue refs are identifiers",
    async () => {
      const connectionString = await createTempDatabase();

      await applyPendingMigrations(connectionString);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const runResponsibleUserRepairHash = await migrationHash(
          "0131_repair_run_responsible_user_context_refs.sql",
        );

        await sql.unsafe(`
          INSERT INTO "companies" ("id", "name", "issue_prefix", "created_at", "updated_at")
          VALUES ('00000000-0000-0000-0000-000000000130', 'Migration Test Co', 'TST130', now(), now())
        `);
        await sql.unsafe(`
          INSERT INTO "company_memberships" (
            "id",
            "company_id",
            "principal_type",
            "principal_id",
            "status",
            "membership_role",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000131',
            '00000000-0000-0000-0000-000000000130',
            'user',
            'owner-user',
            'active',
            'owner',
            now(),
            now()
          )
        `);
        await sql.unsafe(`
          INSERT INTO "agents" ("id", "company_id", "name", "role", "adapter_type", "created_at", "updated_at")
          VALUES (
            '00000000-0000-0000-0000-000000000132',
            '00000000-0000-0000-0000-000000000130',
            'Migration Agent',
            'general',
            'process',
            now(),
            now()
          )
        `);
        await sql.unsafe(`
          INSERT INTO "issues" (
            "id",
            "company_id",
            "title",
            "status",
            "responsible_user_id",
            "identifier",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000133',
            '00000000-0000-0000-0000-000000000130',
            'Identifier referenced issue',
            'todo',
            'issue-user',
            'TST130-1',
            now(),
            now()
          )
        `);
        await sql.unsafe(`
          INSERT INTO "heartbeat_runs" (
            "id",
            "company_id",
            "agent_id",
            "status",
            "responsible_user_id",
            "context_snapshot",
            "created_at",
            "updated_at"
          )
          VALUES (
            '00000000-0000-0000-0000-000000000134',
            '00000000-0000-0000-0000-000000000130',
            '00000000-0000-0000-0000-000000000132',
            'completed',
            NULL,
            '{"issueId":"TST130-1"}'::jsonb,
            now(),
            now()
          )
        `);
        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${runResponsibleUserRepairHash}'`,
        );
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0131_repair_run_responsible_user_context_refs.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const runs = await verifySql.unsafe<{ responsible_user_id: string | null }[]>(`
          SELECT "responsible_user_id"
          FROM "heartbeat_runs"
          WHERE "id" = '00000000-0000-0000-0000-000000000134'
        `);
        expect(runs).toEqual([{ responsible_user_id: "issue-user" }]);

      } finally {
        await verifySql.end();
      }
    },
    20_000,
  );

  it(
    "preserves legacy runs while adding native persistence and replay-safe status versioning",
    async () => {
      const connectionString = await createTempDatabase();
      await applyPendingMigrations(connectionString);

      const nativePersistenceHash = await migrationHash("0227_modern_pandemic.sql");
      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      const companyId = "10000000-0000-4000-8000-000000000227";
      const agentId = "20000000-0000-4000-8000-000000000227";
      const runId = "30000000-0000-4000-8000-000000000227";
      const issueId = "40000000-0000-4000-8000-000000000227";
      const contractId = "50000000-0000-4000-8000-000000000227";
      const resultId = "60000000-0000-4000-8000-000000000227";
      const assessmentId = "70000000-0000-4000-8000-000000000227";
      const decisionId = "80000000-0000-4000-8000-000000000227";
      const otherCompanyId = "11000000-0000-4000-8000-000000000227";
      const otherAgentId = "21000000-0000-4000-8000-000000000227";
      const otherRunId = "31000000-0000-4000-8000-000000000227";
      const otherIssueId = "41000000-0000-4000-8000-000000000227";
      const otherContractId = "51000000-0000-4000-8000-000000000227";
      const otherResultId = "61000000-0000-4000-8000-000000000227";
      const otherAssessmentId = "71000000-0000-4000-8000-000000000227";
      const otherDecisionId = "81000000-0000-4000-8000-000000000227";

      try {
        await sql.unsafe(`
          DROP TABLE IF EXISTS status_decision_effects, status_decisions, work_assessments,
            native_run_finalizations, native_run_results, completion_contracts CASCADE;
          DROP TRIGGER IF EXISTS paperclip_issue_status_version_trigger ON issues;
          DROP FUNCTION IF EXISTS paperclip_bump_issue_status_version();
          DROP INDEX IF EXISTS issues_company_id_uq;
          DROP INDEX IF EXISTS heartbeat_run_events_run_source_event_uq;
          DROP INDEX IF EXISTS heartbeat_run_events_run_source_seq_uq;
          ALTER TABLE heartbeat_run_events
            DROP COLUMN IF EXISTS source_instance_id,
            DROP COLUMN IF EXISTS source_event_id,
            DROP COLUMN IF EXISTS source_seq,
            DROP COLUMN IF EXISTS source_payload_sha256,
            DROP COLUMN IF EXISTS protocol_schema_version;
          ALTER TABLE heartbeat_run_events ALTER COLUMN seq TYPE integer;
          ALTER TABLE heartbeat_runs
            DROP COLUMN IF EXISTS runtime_mode,
            DROP COLUMN IF EXISTS runtime_mode_resolver_version,
            DROP COLUMN IF EXISTS runtime_mode_reason,
            DROP COLUMN IF EXISTS runtime_mode_resolved_at,
            DROP COLUMN IF EXISTS runner_profile_json,
            DROP COLUMN IF EXISTS runner_instance_id,
            DROP COLUMN IF EXISTS native_session_id,
            DROP COLUMN IF EXISTS native_issue_id,
            DROP COLUMN IF EXISTS driver_kind,
            DROP COLUMN IF EXISTS driver_version,
            DROP COLUMN IF EXISTS completion_contract_id,
            DROP COLUMN IF EXISTS completion_contract_sha256,
            DROP COLUMN IF EXISTS next_event_seq,
            DROP COLUMN IF EXISTS native_phase,
            DROP COLUMN IF EXISTS native_phase_updated_at;
          ALTER TABLE issues
            DROP COLUMN IF EXISTS status_version,
            DROP COLUMN IF EXISTS last_status_decision_id;
        `);
        await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${nativePersistenceHash}`;
        await sql`
          INSERT INTO companies (id, name, issue_prefix)
          VALUES (${companyId}, 'Native persistence fixture', 'NPF')
        `;
        await sql`
          INSERT INTO agents (id, company_id, name)
          VALUES (${agentId}, ${companyId}, 'Legacy migration agent')
        `;
        await sql`
          INSERT INTO heartbeat_runs (id, company_id, agent_id, status)
          VALUES (${runId}, ${companyId}, ${agentId}, 'succeeded')
        `;
        await sql`
          INSERT INTO issues (id, company_id, title, status)
          VALUES (${issueId}, ${companyId}, 'Legacy migration issue', 'in_progress')
        `;
        await sql.unsafe(`
          INSERT INTO heartbeat_run_events
            (company_id, run_id, agent_id, seq, event_type, stream, level, message, payload, created_at)
          VALUES
            ('${companyId}', '${runId}', '${agentId}', 1, 'legacy.start', 'system', 'info', 'one', '{"bytes":"alpha-1"}'::jsonb, '2026-08-01T00:00:01.000Z'),
            ('${companyId}', '${runId}', '${agentId}', 5, 'legacy.log', 'stdout', 'info', 'first-five', '{"bytes":"beta-5a"}'::jsonb, '2026-08-01T00:00:02.000Z'),
            ('${companyId}', '${runId}', '${agentId}', 5, 'legacy.log', 'stderr', 'warn', 'duplicate-five', '{"bytes":"gamma-5b"}'::jsonb, '2026-08-01T00:00:03.000Z'),
            ('${companyId}', '${runId}', '${agentId}', 9, 'legacy.end', 'system', 'info', 'nine', '{"bytes":"delta-9"}'::jsonb, '2026-08-01T00:00:04.000Z')
        `);
      } finally {
        await sql.end();
      }

      await applyPendingMigrations(connectionString);

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const events = await verifySql.unsafe<{
          seq: string;
          event_type: string;
          stream: string;
          level: string;
          message: string;
          payload: { bytes: string };
          created_at: Date;
        }[]>(`
          SELECT seq, event_type, stream, level, message, payload, created_at
          FROM heartbeat_run_events
          WHERE run_id = '${runId}'
          ORDER BY id
        `);
        expect(events.map((event) => Number(event.seq))).toEqual([1, 5, 5, 9]);
        expect(events.map(({ seq: _seq, ...event }) => ({
          ...event,
          created_at: event.created_at.toISOString(),
        }))).toEqual([
          {
            event_type: "legacy.start",
            stream: "system",
            level: "info",
            message: "one",
            payload: { bytes: "alpha-1" },
            created_at: "2026-08-01T00:00:01.000Z",
          },
          {
            event_type: "legacy.log",
            stream: "stdout",
            level: "info",
            message: "first-five",
            payload: { bytes: "beta-5a" },
            created_at: "2026-08-01T00:00:02.000Z",
          },
          {
            event_type: "legacy.log",
            stream: "stderr",
            level: "warn",
            message: "duplicate-five",
            payload: { bytes: "gamma-5b" },
            created_at: "2026-08-01T00:00:03.000Z",
          },
          {
            event_type: "legacy.end",
            stream: "system",
            level: "info",
            message: "nine",
            payload: { bytes: "delta-9" },
            created_at: "2026-08-01T00:00:04.000Z",
          },
        ]);

        const runs = await verifySql.unsafe<{ runtime_mode: string; next_event_seq: string }[]>(`
          SELECT runtime_mode, next_event_seq
          FROM heartbeat_runs
          WHERE id = '${runId}'
        `);
        expect(runs.map((run) => ({
          runtimeMode: run.runtime_mode,
          nextEventSeq: Number(run.next_event_seq),
        }))).toEqual([{ runtimeMode: "legacy", nextEventSeq: 10 }]);

        const nativeRowsBefore = await verifySql.unsafe<{ table_name: string; row_count: number }[]>(`
          SELECT 'completion_contracts' AS table_name, count(*)::int AS row_count FROM completion_contracts
          UNION ALL SELECT 'native_run_results', count(*)::int FROM native_run_results
          UNION ALL SELECT 'native_run_finalizations', count(*)::int FROM native_run_finalizations
          UNION ALL SELECT 'work_assessments', count(*)::int FROM work_assessments
          UNION ALL SELECT 'status_decisions', count(*)::int FROM status_decisions
          UNION ALL SELECT 'status_decision_effects', count(*)::int FROM status_decision_effects
          ORDER BY table_name
        `);
        expect(nativeRowsBefore.every((row) => row.row_count === 0)).toBe(true);

        await verifySql`
          INSERT INTO companies (id, name, issue_prefix)
          VALUES (${otherCompanyId}, 'Other native persistence fixture', 'ONP')
        `;
        await verifySql`
          INSERT INTO agents (id, company_id, name)
          VALUES (${otherAgentId}, ${otherCompanyId}, 'Other native migration agent')
        `;
        await verifySql`
          INSERT INTO heartbeat_runs (
            id, company_id, agent_id, status, native_issue_id, completion_contract_id
          ) VALUES (
            ${otherRunId}, ${otherCompanyId}, ${otherAgentId}, 'succeeded',
            ${otherIssueId}, ${otherContractId}
          )
        `;
        await verifySql`
          INSERT INTO issues (id, company_id, title, status)
          VALUES (${otherIssueId}, ${otherCompanyId}, 'Other native issue', 'in_progress')
        `;
        await verifySql`
          UPDATE heartbeat_runs
          SET native_issue_id = ${issueId}, completion_contract_id = ${contractId}
          WHERE id = ${runId}
        `;

        await expect(verifySql`
          INSERT INTO completion_contracts (
            company_id, issue_id, revision, schema_version, policy_version,
            risk, completion_authority, incomplete_criteria_policy, contract_json,
            canonical_sha256, created_by_actor_type, created_by_actor_id
          ) VALUES (
            ${companyId}, ${otherIssueId}, 1, 'todero.completion-contract.v1',
            'policy-v1', 'low', 'server', 'review', ${JSON.stringify({ criteria: [] })}::jsonb,
            'cross-company-contract-sha', 'system', 'migration-test'
          )
        `).rejects.toThrow(/completion_contracts_issue_company_fk/);

        await verifySql`
          INSERT INTO completion_contracts (
            id, company_id, issue_id, revision, schema_version, policy_version,
            risk, completion_authority, incomplete_criteria_policy, contract_json,
            canonical_sha256, created_by_actor_type, created_by_actor_id
          ) VALUES (
            ${contractId}, ${companyId}, ${issueId}, 1, 'todero.completion-contract.v1',
            'policy-v1', 'low', 'server', 'review', ${JSON.stringify({ criteria: [] })}::jsonb,
            'contract-sha', 'system', 'migration-test'
          )
        `;
        await verifySql`
          INSERT INTO completion_contracts (
            id, company_id, issue_id, revision, schema_version, policy_version,
            risk, completion_authority, incomplete_criteria_policy, contract_json,
            canonical_sha256, created_by_actor_type, created_by_actor_id
          ) VALUES (
            ${otherContractId}, ${otherCompanyId}, ${otherIssueId}, 1,
            'todero.completion-contract.v1', 'policy-v1', 'low', 'server', 'review',
            ${JSON.stringify({ criteria: [] })}::jsonb, 'other-contract-sha',
            'system', 'migration-test'
          )
        `;

        await expect(verifySql`
          INSERT INTO native_run_results (
            company_id, issue_id, run_id, completion_contract_id,
            server_fingerprint, schema_status, result_json, canonical_sha256
          ) VALUES (
            ${companyId}, ${issueId}, ${otherRunId}, ${contractId},
            'cross-company-run', 'valid', ${JSON.stringify({ summary: "invalid" })}::jsonb,
            'cross-company-run-sha'
          )
        `).rejects.toThrow(/native_run_results_run_contract_owner_fk/);

        await expect(verifySql`
          INSERT INTO native_run_results (
            company_id, issue_id, run_id, completion_contract_id,
            server_fingerprint, schema_status, result_json, canonical_sha256
          ) VALUES (
            ${companyId}, ${issueId}, ${runId}, ${otherContractId},
            'cross-company-contract', 'valid', ${JSON.stringify({ summary: "invalid" })}::jsonb,
            'cross-company-contract-sha'
          )
        `).rejects.toThrow(/native_run_results_run_contract_owner_fk/);

        await verifySql`
          INSERT INTO native_run_results (
            id, company_id, issue_id, run_id, completion_contract_id,
            server_fingerprint, schema_status, result_json, canonical_sha256
          ) VALUES (
            ${resultId}, ${companyId}, ${issueId}, ${runId}, ${contractId},
            'result-fingerprint', 'valid', ${JSON.stringify({ summary: "done" })}::jsonb, 'result-sha'
          )
        `;
        await verifySql`
          INSERT INTO native_run_results (
            id, company_id, issue_id, run_id, completion_contract_id,
            server_fingerprint, schema_status, result_json, canonical_sha256
          ) VALUES (
            ${otherResultId}, ${otherCompanyId}, ${otherIssueId}, ${otherRunId},
            ${otherContractId}, 'other-result-fingerprint', 'valid',
            ${JSON.stringify({ summary: "other" })}::jsonb, 'other-result-sha'
          )
        `;

        await expect(verifySql`
          INSERT INTO work_assessments (
            company_id, issue_id, run_id, contract_id, result_id,
            trigger_kind, trigger_actor_company_id, prior_issue_status,
            prior_status_version, policy_version, assessment_json, input_digest
          ) VALUES (
            ${companyId}, ${issueId}, ${runId}, ${contractId}, ${otherResultId},
            'run_terminal', ${companyId}, 'in_progress', 0, 'policy-v1',
            ${JSON.stringify({ disposition: "invalid" })}::jsonb,
            'cross-company-assessment-input-sha'
          )
        `).rejects.toThrow(/work_assessments_result_owner_fk/);

        await expect(verifySql`
          INSERT INTO work_assessments (
            company_id, issue_id, run_id, contract_id, result_id,
            trigger_kind, trigger_actor_company_id, prior_issue_status,
            prior_status_version, policy_version, assessment_json, input_digest
          ) VALUES (
            ${companyId}, ${issueId}, ${runId}, ${contractId}, ${resultId},
            'run_terminal', ${otherCompanyId}, 'in_progress', 0, 'policy-v1',
            ${JSON.stringify({ disposition: "invalid" })}::jsonb,
            'cross-company-trigger-input-sha'
          )
        `).rejects.toThrow(/work_assessments_trigger_actor_company_check/);

        await verifySql`
          INSERT INTO work_assessments (
            id, company_id, issue_id, run_id, contract_id, result_id,
            trigger_kind, trigger_actor_company_id, prior_issue_status,
            prior_status_version, policy_version, assessment_json, input_digest
          ) VALUES (
            ${assessmentId}, ${companyId}, ${issueId}, ${runId}, ${contractId}, ${resultId},
            'run_terminal', ${companyId}, 'in_progress', 0, 'policy-v1',
            ${JSON.stringify({ disposition: "done" })}::jsonb, 'assessment-input-sha'
          )
        `;
        await verifySql`
          INSERT INTO work_assessments (
            id, company_id, issue_id, run_id, contract_id, result_id,
            trigger_kind, trigger_actor_company_id, prior_issue_status,
            prior_status_version, policy_version, assessment_json, input_digest
          ) VALUES (
            ${otherAssessmentId}, ${otherCompanyId}, ${otherIssueId}, ${otherRunId},
            ${otherContractId}, ${otherResultId}, 'run_terminal', ${otherCompanyId},
            'in_progress', 0, 'policy-v1',
            ${JSON.stringify({ disposition: "done" })}::jsonb, 'other-assessment-input-sha'
          )
        `;

        await expect(verifySql`
          INSERT INTO status_decisions (
            company_id, issue_id, run_id, assessment_id, decision_version,
            policy_version, from_status, to_status, reason_code,
            decision_json, decision_digest
          ) VALUES (
            ${companyId}, ${issueId}, ${runId}, ${otherAssessmentId}, 1,
            'policy-v1', 'in_progress', 'done', 'native_result_accepted',
            ${JSON.stringify({ toStatus: "done" })}::jsonb, 'cross-company-decision-sha'
          )
        `).rejects.toThrow(/status_decisions_assessment_owner_fk/);

        await verifySql`
          INSERT INTO status_decisions (
            id, company_id, issue_id, run_id, assessment_id, decision_version,
            policy_version, from_status, to_status, reason_code,
            decision_json, decision_digest
          ) VALUES (
            ${decisionId}, ${companyId}, ${issueId}, ${runId}, ${assessmentId}, 1,
            'policy-v1', 'in_progress', 'done', 'native_result_accepted',
            ${JSON.stringify({ toStatus: "done" })}::jsonb, 'decision-sha'
          )
        `;
        await verifySql`
          INSERT INTO status_decisions (
            id, company_id, issue_id, run_id, assessment_id, decision_version,
            policy_version, from_status, to_status, reason_code,
            decision_json, decision_digest
          ) VALUES (
            ${otherDecisionId}, ${otherCompanyId}, ${otherIssueId}, ${otherRunId},
            ${otherAssessmentId}, 1, 'policy-v1', 'in_progress', 'done',
            'native_result_accepted', ${JSON.stringify({ toStatus: "done" })}::jsonb,
            'other-decision-sha'
          )
        `;

        await expect(verifySql`
          INSERT INTO status_decision_effects (
            company_id, issue_id, decision_id, ordinal, effect_kind,
            target_type, idempotency_key, payload
          ) VALUES (
            ${companyId}, ${issueId}, ${otherDecisionId}, 0, 'update_issue_status',
            'issue', 'cross-company-decision-effect', ${JSON.stringify({ status: "done" })}::jsonb
          )
        `).rejects.toThrow(/status_decision_effects_decision_owner_fk/);

        await verifySql`
          INSERT INTO status_decision_effects (
            company_id, issue_id, decision_id, ordinal, effect_kind,
            target_type, idempotency_key, payload
          ) VALUES (
            ${companyId}, ${issueId}, ${decisionId}, 0, 'update_issue_status',
            'issue', 'decision-effect-1', ${JSON.stringify({ status: "done" })}::jsonb
          )
        `;

        await expect(verifySql`
          INSERT INTO native_run_finalizations (
            run_id, company_id, issue_id, phase, result_id, assessment_id, decision_id
          ) VALUES (
            ${runId}, ${companyId}, ${issueId}, 'committed', ${resultId},
            ${assessmentId}, ${otherDecisionId}
          )
        `).rejects.toThrow(/native_run_finalizations_decision_owner_fk/);

        await verifySql`
          INSERT INTO native_run_finalizations (
            run_id, company_id, issue_id, phase, result_id, assessment_id, decision_id
          ) VALUES (
            ${runId}, ${companyId}, ${issueId}, 'committed', ${resultId}, ${assessmentId}, ${decisionId}
          )
        `;

        await verifySql`UPDATE issues SET title = 'Renamed legacy issue' WHERE id = ${issueId}`;
        await verifySql`UPDATE issues SET status = 'done' WHERE id = ${issueId}`;
        const issues = await verifySql.unsafe<{ status: string; status_version: string }[]>(`
          SELECT status, status_version
          FROM issues
          WHERE id = '${issueId}'
        `);
        expect(issues.map((issue) => ({
          status: issue.status,
          statusVersion: Number(issue.status_version),
        }))).toEqual([{ status: "done", statusVersion: 1 }]);

        await verifySql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${nativePersistenceHash}`;
      } finally {
        await verifySql.end();
      }

      await expect(applyPendingMigrations(connectionString)).resolves.toBeUndefined();
      await expect(inspectMigrations(connectionString)).resolves.toMatchObject({
        status: "upToDate",
      });

      const replaySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const replayed = await replaySql.unsafe<{
          status_version: string;
          next_event_seq: string;
          trigger_count: number;
          finalization_count: number;
        }[]>(`
          SELECT
            issue.status_version,
            run.next_event_seq,
            (
              SELECT count(*)::int
              FROM pg_trigger
              WHERE tgname = 'paperclip_issue_status_version_trigger'
                AND NOT tgisinternal
            ) AS trigger_count,
            (
              SELECT count(*)::int
              FROM native_run_finalizations
              WHERE run_id = '${runId}'
            ) AS finalization_count
          FROM issues issue
          CROSS JOIN heartbeat_runs run
          WHERE issue.id = '${issueId}' AND run.id = '${runId}'
        `);
        expect(replayed.map((row) => ({
          statusVersion: Number(row.status_version),
          nextEventSeq: Number(row.next_event_seq),
          triggerCount: row.trigger_count,
          finalizationCount: row.finalization_count,
        }))).toEqual([{
          statusVersion: 1,
          nextEventSeq: 10,
          triggerCount: 1,
          finalizationCount: 1,
        }]);
      } finally {
        await replaySql.end();
      }
    },
    60_000,
  );
});

// PR #48 Blocker 2: 64 of 232 migration files (as of this fix) contain no
// `--> statement-breakpoint` marker at all, and 20 of those actually bundle
// more than one SQL statement without one -- the shape that let
// `migrationStatementAlreadyApplied` verify only the first statement in the
// blob and decide the fate of the whole file (see `0182_connections_v3_schema_core.sql`,
// 10 statements, no markers). This fix does not rewrite the 232 existing
// migration files (out of scope; the runtime fix is
// `statementContainsMultipleTopLevelStatements`, exercised directly in the
// unit cases below) -- this lint test only makes the corpus's current shape
// visible and pins the counts so a newly authored migration cannot silently
// grow the list.
describe("migration statement-breakpoint lint", () => {
  it("reports how many migration files bundle more than one statement without a --> statement-breakpoint marker", async () => {
    const entries = await fs.promises.readdir(new URL("./migrations", import.meta.url), {
      withFileTypes: true,
    });
    const sqlFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"));

    const filesWithNoBreakpointAtAll: string[] = [];
    const filesBundlingMultipleStatements: string[] = [];

    for (const entry of sqlFiles) {
      const content = await fs.promises.readFile(
        new URL(`./migrations/${entry.name}`, import.meta.url),
        "utf8",
      );
      if (!content.includes("--> statement-breakpoint")) {
        filesWithNoBreakpointAtAll.push(entry.name);
      }
      const statements = splitMigrationStatements(content);
      if (statements.some((statement) => statementContainsMultipleTopLevelStatements(statement))) {
        filesBundlingMultipleStatements.push(entry.name);
      }
    }

    console.info(
      `[migration lint] ${filesWithNoBreakpointAtAll.length} of ${sqlFiles.length} migration files contain no --> statement-breakpoint marker at all; ` +
        `${filesBundlingMultipleStatements.length} of those actually bundle more than one statement without one.`,
    );

    // Baseline as of this fix (2026-09-06): do not increase either number by
    // adding a new marker-less multi-statement migration. A decrease (an
    // existing file gaining markers) is welcome and should lower these.
    expect(filesWithNoBreakpointAtAll.length).toBe(64);
    expect(filesBundlingMultipleStatements.length).toBe(20);
  });
});

describeEmbeddedPostgres("reconcilePendingMigrationHistory", () => {
  it(
    "does not stamp migration 0229 while migration 0073 (earlier in journal order) is still unresolved",
    async () => {
      const connectionString = await createTempDatabase();
      await applyPendingMigrations(connectionString);

      const shinySaloHash = await migrationHash("0073_shiny_salo.sql");
      const dropAttachmentHash = await migrationHash(
        "0229_drop_company_brand_color_and_attachment_max_bytes.sql",
      );

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash IN ('${shinySaloHash}', '${dropAttachmentHash}')`,
        );
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        reason: "pending-migrations",
        pendingMigrations: expect.arrayContaining([
          "0073_shiny_salo.sql",
          "0229_drop_company_brand_color_and_attachment_max_bytes.sql",
        ]),
      });

      const reconcileResult = await reconcilePendingMigrationHistory(connectionString);
      // 0073's ADD COLUMN cannot be verified applied (the column is
      // genuinely absent -- 0229 already dropped it) -- 0229 must not be
      // stamped ahead of it just because its own DROP COLUMN IF EXISTS
      // check independently reads "applied" (the column it targets is also
      // absent). Real case from PR #48, commit 1fe8112c.
      expect(reconcileResult.repairedMigrations).not.toContain(
        "0229_drop_company_brand_color_and_attachment_max_bytes.sql",
      );
      expect(reconcileResult.remainingMigrations).toEqual(
        expect.arrayContaining([
          "0073_shiny_salo.sql",
          "0229_drop_company_brand_color_and_attachment_max_bytes.sql",
        ]),
      );
      expect(reconcileResult.skippedStatements.map((skipped) => skipped.migrationFile)).toEqual(
        expect.arrayContaining([
          "0073_shiny_salo.sql",
          "0229_drop_company_brand_color_and_attachment_max_bytes.sql",
        ]),
      );

      // Left pending together, `applyPendingMigrationsManually` (journal-
      // ordered, per-statement, idempotent) replays 0073 then 0229 back to
      // back and converges on the correct end state instead of permanently
      // re-adding a column 0229 already retired.
      await applyPendingMigrations(connectionString);

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const columns = await verifySql.unsafe<{ column_name: string }[]>(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'companies'
            AND column_name IN ('attachment_max_bytes', 'brand_color')
        `);
        expect(columns).toEqual([]);
      } finally {
        await verifySql.end();
      }

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");
    },
    40_000,
  );
});

describeEmbeddedPostgres("applyPendingMigrationsManually savepoint recovery", () => {
  it(
    "treats a unique violation on a replayed backfill as already applied instead of failing the whole migration (Critical 3)",
    async () => {
      const connectionString = await createTempDatabase();
      await applyPendingMigrations(connectionString);

      const prettyDoctorOctopusHash = await migrationHash("0032_pretty_doctor_octopus.sql");
      const companyId = "00000000-0000-0000-0000-0000000a0032";

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        // A company with a monthly budget already set -- exactly the shape
        // migration 0032's company-scope backfill (`INSERT ... SELECT ...
        // FROM companies WHERE budget_monthly_cents > 0`, no `ON CONFLICT`)
        // targets.
        await sql.unsafe(`
          INSERT INTO "companies" ("id", "name", "issue_prefix", "budget_monthly_cents", "created_at", "updated_at")
          VALUES ('${companyId}', 'Replay Conflict Co', 'RPC032', 500, now(), now())
        `);
        // Simulate the backfill having already run once for this company:
        // the row the statement would insert already exists, and
        // `budget_policies_company_scope_metric_unique_idx` (0032's own
        // unique index on company_id/scope_type/scope_id/metric/window_kind)
        // makes a second attempt a 23505, not a duplicate.
        await sql.unsafe(`
          INSERT INTO "budget_policies" (
            "company_id", "scope_type", "scope_id", "metric", "window_kind", "amount"
          ) VALUES (
            '${companyId}', 'company', '${companyId}', 'billed_cents', 'calendar_month_utc', 500
          )
        `);
        // Migration 0034 later drops and replaces 0032's own
        // "budget_incidents_policy_window_threshold_idx" with a partial
        // (WHERE-clause) version -- unrelated to what this test targets, but
        // it means the live index no longer matches 0032's own CREATE UNIQUE
        // INDEX statement byte-for-byte, which (correctly, per Critical 4)
        // reads as "unrecognized" rather than a false-positive "applied" and
        // would otherwise fail this replay on an unrelated 42P07. Revert it
        // to 0032's own shape so 0032 alone can be isolated and replayed
        // cleanly; 0034's own journal entry is untouched.
        await sql.unsafe(`DROP INDEX "budget_incidents_policy_window_threshold_idx"`);
        await sql.unsafe(`
          CREATE UNIQUE INDEX "budget_incidents_policy_window_threshold_idx"
          ON "budget_incidents" USING btree ("policy_id","window_start","threshold_type")
        `);
        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${prettyDoctorOctopusHash}'`,
        );
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0032_pretty_doctor_octopus.sql"],
        reason: "pending-migrations",
      });

      // Before Critical 3's fix this throws: the replayed INSERT hits the
      // unique index and the uncaught 23505 fails the whole migration.
      await expect(applyPendingMigrations(connectionString)).resolves.toBeUndefined();

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const rows = await verifySql.unsafe<{ count: number }[]>(`
          SELECT count(*)::int AS count
          FROM "budget_policies"
          WHERE "company_id" = '${companyId}' AND "scope_type" = 'company'
        `);
        // No duplicate row -- the conflicting statement was rolled back to
        // its savepoint, not partially applied.
        expect(rows[0]?.count).toBe(1);
      } finally {
        await verifySql.end();
      }
    },
    30_000,
  );

  it(
    "still fails the whole migration loudly on a non-unique-violation error mid-file, and does not stamp it (regression)",
    async () => {
      const connectionString = await createTempDatabase();
      await applyPendingMigrations(connectionString);

      const prettyDoctorOctopusHash = await migrationHash("0032_pretty_doctor_octopus.sql");
      const companyId = "00000000-0000-0000-0000-0000000b0032";

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(`
          INSERT INTO "companies" ("id", "name", "issue_prefix", "budget_monthly_cents", "created_at", "updated_at")
          VALUES ('${companyId}', 'Mid-File Failure Co', 'MFF032', 500, now(), now())
        `);
        // Force 0032's agent-scope backfill statement to fail with
        // something other than a unique violation (an undefined-column
        // error, not 23505) -- the savepoint added for Critical 3 must not
        // swallow this.
        await sql.unsafe(`ALTER TABLE "agents" DROP COLUMN "budget_monthly_cents"`);
        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${prettyDoctorOctopusHash}'`,
        );
      } finally {
        await sql.end();
      }

      await expect(applyPendingMigrations(connectionString)).rejects.toThrow();

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const policyRows = await verifySql.unsafe<{ count: number }[]>(`
          SELECT count(*)::int AS count FROM "budget_policies" WHERE "company_id" = '${companyId}'
        `);
        // The company-scope INSERT ran inside the same transaction as the
        // statement that then failed -- it must roll back with everything
        // else in the file, not persist as a partial apply.
        expect(policyRows[0]?.count).toBe(0);

        const journalRows = await verifySql.unsafe<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM "drizzle"."__drizzle_migrations" WHERE hash = '${prettyDoctorOctopusHash}'`,
        );
        expect(journalRows[0]?.count).toBe(0);
      } finally {
        await verifySql.end();
      }
    },
    30_000,
  );
});

describeEmbeddedPostgres("migrationStatementAlreadyApplied DDL shape checks", () => {
  let connectionString: string;
  let sql: ReturnType<typeof postgres>;
  let cleanupDb: (() => Promise<void>) | undefined;

  // Deliberately calls `startEmbeddedPostgresTestDatabase` directly instead
  // of the module's `createTempDatabase` helper: that helper pushes its
  // cleanup onto the shared, module-level `cleanups` array that the global
  // `afterEach` above drains after *every* `it` in this file. These unit
  // cases share one database across many lightweight `it`s on purpose (each
  // just checks one DDL shape) — going through `createTempDatabase` would
  // have the first `it`'s `afterEach` tear the shared cluster down out from
  // under every case after it.
  beforeAll(async () => {
    const db = await startEmbeddedPostgresTestDatabase("todero-db-client-ddl-shape-");
    connectionString = db.connectionString;
    cleanupDb = db.cleanup;
    sql = postgres(connectionString, { max: 1, onnotice: () => {} });
    await sql.unsafe(`
      CREATE TABLE "ddl_shape_probe" (
        "id" uuid PRIMARY KEY,
        "company_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL
      )
    `);
    await sql.unsafe(
      `CREATE INDEX "ddl_shape_probe_company_idx" ON "ddl_shape_probe" USING btree ("company_id")`,
    );
  }, 90_000);

  afterAll(async () => {
    await sql?.end();
    await cleanupDb?.();
  }, 30_000);

  it("CREATE TABLE with a schema-qualified name resolves the real table, not \"public\" itself (Minor 12)", async () => {
    // Before the fix, the single greedy `"([^"]+)"` capture matched
    // "public" (the schema token) as if it were the table name, so this
    // schema-qualified statement -- whose real table already fully exists
    // -- misread as "not-applied".
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'CREATE TABLE "public"."ddl_shape_probe" ("id" uuid PRIMARY KEY, "company_id" uuid NOT NULL, "created_at" timestamptz NOT NULL);',
    );
    expect(state).toBe("applied");
  });

  it("DROP INDEX IF EXISTS on an index that still exists is not-applied", async () => {
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'DROP INDEX IF EXISTS "ddl_shape_probe_company_idx";',
    );
    expect(state).toBe("not-applied");
  });

  it("DROP INDEX IF EXISTS with lowercase keyword casing is still recognized", async () => {
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'drop index if exists "ddl_shape_probe_company_idx";',
    );
    expect(state).toBe("not-applied");
  });

  it("DROP INDEX with an unquoted identifier falls back to unrecognized", async () => {
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      "DROP INDEX IF EXISTS ddl_shape_probe_company_idx;",
    );
    expect(state).toBe("unrecognized");
  });

  it("DROP INDEX with a schema-qualified name resolves the real index, not \"public\" itself (Critical 4/5, Minor 12)", async () => {
    // Before the fix this misread "public" as the index name, found no
    // index called "public", and reported "applied" (already dropped) even
    // though the real index is still there.
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'DROP INDEX IF EXISTS "public"."ddl_shape_probe_company_idx";',
    );
    expect(state).toBe("not-applied");
  });

  it("a dropped index that genuinely no longer exists reads as applied", async () => {
    await sql.unsafe(`CREATE INDEX "ddl_shape_probe_temp_idx" ON "ddl_shape_probe" USING btree ("id")`);
    await sql.unsafe(`DROP INDEX "ddl_shape_probe_temp_idx"`);
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'DROP INDEX IF EXISTS "ddl_shape_probe_temp_idx";',
    );
    expect(state).toBe("applied");
  });

  it("a same-named index with a different definition is unrecognized, not a false-positive applied (Critical 4)", async () => {
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'CREATE INDEX "ddl_shape_probe_company_idx" ON "ddl_shape_probe" USING btree ("company_id","created_at");',
    );
    expect(state).toBe("unrecognized");
  });

  it("a matching CREATE INDEX statement reads as applied", async () => {
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'CREATE INDEX "ddl_shape_probe_company_idx" ON "ddl_shape_probe" USING btree ("company_id");',
    );
    expect(state).toBe("applied");
  });

  it("multi-clause ALTER TABLE ... DROP COLUMN a, DROP COLUMN b is unrecognized, not verified from the first clause alone", async () => {
    await sql.unsafe(`ALTER TABLE "ddl_shape_probe" ADD COLUMN IF NOT EXISTS "extra_a" text`);
    await sql.unsafe(`ALTER TABLE "ddl_shape_probe" ADD COLUMN IF NOT EXISTS "extra_b" text`);
    await sql.unsafe(`ALTER TABLE "ddl_shape_probe" DROP COLUMN "extra_a"`);
    // "extra_a" is already gone but "extra_b" still exists -- a regex
    // anchored only at the start of the statement would match the first
    // DROP COLUMN clause, see it satisfied, and misreport the whole
    // statement as applied while "extra_b" survives.
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'ALTER TABLE "ddl_shape_probe" DROP COLUMN "extra_a", DROP COLUMN "extra_b";',
    );
    expect(state).toBe("unrecognized");
  });

  it("a constraint with the same name but a different definition is unrecognized, not a false-positive applied (Critical 4)", async () => {
    await sql.unsafe(
      `ALTER TABLE "ddl_shape_probe" ADD CONSTRAINT "ddl_shape_probe_company_check" CHECK ("company_id" IS NOT NULL)`,
    );
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'ALTER TABLE "ddl_shape_probe" ADD CONSTRAINT "ddl_shape_probe_company_check" CHECK ("id" IS NOT NULL);',
    );
    expect(state).toBe("unrecognized");
  });

  it("a matching ADD CONSTRAINT CHECK statement reads as applied despite Postgres re-serializing it with extra parens", async () => {
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'ALTER TABLE "ddl_shape_probe" ADD CONSTRAINT "ddl_shape_probe_company_check" CHECK ("company_id" IS NOT NULL);',
    );
    expect(state).toBe("applied");
  });

  it("a matching ADD CONSTRAINT FOREIGN KEY statement reads as applied despite default ON DELETE/UPDATE actions being omitted on read", async () => {
    await sql.unsafe(`CREATE TABLE "ddl_shape_probe_child" ("id" uuid PRIMARY KEY, "probe_id" uuid)`);
    await sql.unsafe(`
      ALTER TABLE "ddl_shape_probe_child" ADD CONSTRAINT "ddl_shape_probe_child_probe_id_fk"
      FOREIGN KEY ("probe_id") REFERENCES "public"."ddl_shape_probe"("id") ON DELETE cascade ON UPDATE no action
    `);
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'ALTER TABLE "ddl_shape_probe_child" ADD CONSTRAINT "ddl_shape_probe_child_probe_id_fk" FOREIGN KEY ("probe_id") REFERENCES "public"."ddl_shape_probe"("id") ON DELETE cascade ON UPDATE no action;',
    );
    expect(state).toBe("applied");
  });

  it("a statement bundling more than one top-level SQL statement is unrecognized (Blocker 2)", async () => {
    const state = await __migrationStatementAlreadyAppliedForTests(
      sql,
      'CREATE TABLE "ddl_shape_never_created_a" ("id" uuid PRIMARY KEY); CREATE TABLE "ddl_shape_never_created_b" ("id" uuid PRIMARY KEY);',
    );
    expect(state).toBe("unrecognized");

    const tables = await sql.unsafe<{ table_name: string }[]>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'ddl_shape_never_created_%'
    `);
    expect(tables).toEqual([]);
  });

  it("heartbeatNextEventSequencesAreCurrent maps a missing heartbeat_runs table to unrecognized instead of throwing (Minor 11)", async () => {
    const isolatedSql = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      // A schema with no `heartbeat_runs` table at all -- distinct from
      // "genuinely not caught up", which every other test in this block
      // would otherwise also exercise against the real, fully migrated
      // `public` schema.
      await isolatedSql.unsafe(`CREATE SCHEMA IF NOT EXISTS "ddl_shape_no_heartbeat"`);
      await isolatedSql.unsafe(`SET search_path TO "ddl_shape_no_heartbeat"`);
      const state = await __migrationStatementAlreadyAppliedForTests(
        isolatedSql,
        'UPDATE "heartbeat_runs" AS run SET "next_event_seq" = COALESCE((SELECT 1), 1) WHERE true;',
      );
      expect(state).toBe("unrecognized");
    } finally {
      await isolatedSql.end();
    }
  });
});

describeEmbeddedPostgres("applyPendingMigrations regression coverage", () => {
  it("a fresh empty database bootstrap never enters the statement-skip path", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    let connectionString: string;
    try {
      connectionString = await createTempDatabase();
    } finally {
      infoSpy.mockRestore();
    }

    const state = await inspectMigrations(connectionString);
    expect(state.status).toBe("upToDate");

    const skipLogged = infoSpy.mock.calls.some(
      ([message]) => typeof message === "string" && message.includes("Skipped statement"),
    );
    expect(skipLogged).toBe(false);
  });

  it("still throws when tables exist but there is no migration journal", async () => {
    const connectionString = await createTempDatabase();
    const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(`DROP TABLE "drizzle"."__drizzle_migrations"`);
    } finally {
      await sql.end();
    }

    await expect(applyPendingMigrations(connectionString)).rejects.toThrow(
      /no migration journal; automatic migration is unsafe/,
    );
  });
});

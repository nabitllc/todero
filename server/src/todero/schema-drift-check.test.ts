import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "@todero/db";
import { sql } from "drizzle-orm";
import { checkSchemaDrift } from "./schema-drift-check.js";
import {
  startEmbeddedPostgresTestDatabase,
  getEmbeddedPostgresTestSupport,
} from "../__tests__/helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("schema drift check", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-schema-drift-check-");
    db = createDb(tempDb.connectionString);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("checks every table and finds nothing to say about a database the migrations just built", async () => {
    const result = await checkSchemaDrift(db);

    expect(result.tablesChecked).toBeGreaterThan(100);
    // A freshly migrated database is the definition of no drift. Anything
    // reported here is the check itself being wrong (e.g. comparing the
    // TypeScript property names instead of the column names).
    expect(result.extraNotNullColumns).toEqual([]);
    expect(result.extraNullableColumns).toEqual([]);
    expect(result.missingColumns).toEqual([]);
    expect(result.issuesFound).toBe(false);
  });

  it("detects extra NOT NULL columns without defaults", async () => {
    // Add a NOT NULL column without a default to a test table
    // Use the issues table which definitely exists after migrations
    await db.execute(
      sql.raw(`ALTER TABLE issues ADD COLUMN test_extra_col text NOT NULL DEFAULT 'temp'`),
    );
    // Remove the default to create a problematic column
    await db.execute(sql.raw(`ALTER TABLE issues ALTER COLUMN test_extra_col DROP DEFAULT`));

    const result = await checkSchemaDrift(db);

    expect(result.issuesFound).toBe(true);
    expect(result.extraNotNullColumns).toContainEqual({
      table: "issues",
      columns: expect.arrayContaining(["test_extra_col"]),
    });

    // Cleanup
    await db.execute(sql.raw(`ALTER TABLE issues DROP COLUMN test_extra_col`));
  });

  /**
   * The startup log prints nothing at all unless issuesFound is true, so a
   * database whose only drift is an extra nullable column used to report as
   * clean and the column was never shown. It is still drift.
   */
  it("flags a database whose only drift is an extra nullable column", async () => {
    await db.execute(sql.raw(`ALTER TABLE issues ADD COLUMN test_only_nullable text`));

    const result = await checkSchemaDrift(db);

    expect(result.extraNotNullColumns).toEqual([]);
    expect(result.missingColumns).toEqual([]);
    expect(result.extraNullableColumns).toContainEqual({
      table: "issues",
      columns: expect.arrayContaining(["test_only_nullable"]),
    });
    expect(result.issuesFound).toBe(true);

    await db.execute(sql.raw(`ALTER TABLE issues DROP COLUMN test_only_nullable`));
  });

  it("reports multiple issues when present", async () => {
    // Add both a NOT NULL column and a nullable column
    await db.execute(
      sql.raw(`ALTER TABLE issues ADD COLUMN test_not_null text NOT NULL DEFAULT 'temp'`),
    );
    await db.execute(
      sql.raw(`ALTER TABLE issues ALTER COLUMN test_not_null DROP DEFAULT`),
    );
    await db.execute(
      sql.raw(`ALTER TABLE issues ADD COLUMN test_nullable text`),
    );

    const result = await checkSchemaDrift(db);

    expect(result.issuesFound).toBe(true);
    const issuesNotNull = result.extraNotNullColumns.find(
      (r) => r.table === "issues",
    );
    expect(issuesNotNull?.columns).toContain("test_not_null");

    const issuesNullable = result.extraNullableColumns.find(
      (r) => r.table === "issues",
    );
    expect(issuesNullable?.columns).toContain("test_nullable");

    // Cleanup
    await db.execute(sql.raw(`ALTER TABLE issues DROP COLUMN test_not_null`));
    await db.execute(sql.raw(`ALTER TABLE issues DROP COLUMN test_nullable`));
  });
});

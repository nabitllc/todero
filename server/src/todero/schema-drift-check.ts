import type { Db } from "@todero/db";
import * as dbExports from "@todero/db";
import { getTableColumns, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

export interface SchemaDriftCheckResult {
  tablesChecked: number;
  issuesFound: boolean;
  extraNullableColumns: Array<{ table: string; columns: string[] }>;
  extraNotNullColumns: Array<{ table: string; columns: string[] }>;
  missingColumns: Array<{ table: string; columns: string[] }>;
}

/**
 * Compare the Drizzle table definitions with the actual database schema
 * from information_schema.columns. Warn about schema drift that could cause
 * insert failures or broken queries. Never alter the schema.
 */
export async function checkSchemaDrift(db: Db): Promise<SchemaDriftCheckResult> {
  const result: SchemaDriftCheckResult = {
    tablesChecked: 0,
    issuesFound: false,
    extraNullableColumns: [],
    extraNotNullColumns: [],
    missingColumns: [],
  };

  // Collect all Drizzle table definitions from the exported schema
  const tableDefinitions: Array<{
    name: string;
    pgTable: any;
  }> = [];

  for (const [key, value] of Object.entries(dbExports)) {
    // Check if it's a Drizzle PgTable by trying to get its config
    if (value && typeof value === "object") {
      try {
        const config = getTableConfig(value);
        if (config && config.name) {
          tableDefinitions.push({
            name: config.name,
            pgTable: value,
          });
        }
      } catch {
        // Not a table, skip
      }
    }
  }

  if (tableDefinitions.length === 0) {
    return result;
  }

  result.tablesChecked = tableDefinitions.length;

  // Fetch all columns from information_schema for public schema tables
  // Build table list safely with sql.raw for the literal table names
  const tableNames = tableDefinitions.map((t) => t.name);
  const tableNameList = sql.raw(
    tableNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(","),
  );

  const schemaRows: any[] = await db.execute(
    sql`
      SELECT
        table_name,
        column_name,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (${tableNameList})
      ORDER BY table_name, ordinal_position
    `,
  );

  // Group by table name
  const schemaByTable = new Map<
    string,
    Array<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>
  >();

  for (const row of schemaRows) {
    const tableName = row.table_name as string;
    if (!schemaByTable.has(tableName)) {
      schemaByTable.set(tableName, []);
    }
    schemaByTable.get(tableName)!.push({
      column_name: row.column_name as string,
      is_nullable: row.is_nullable as string,
      column_default: row.column_default as string | null,
    });
  }

  // Check each table definition against the actual schema
  for (const { name: tableName, pgTable } of tableDefinitions) {
    const actualColumns = schemaByTable.get(tableName) || [];
    const actualColumnsByName = new Map(
      actualColumns.map((col) => [col.column_name, col]),
    );

    // Drizzle keys its columns by the TypeScript property name (camelCase);
    // the database knows them by `column.name` (snake_case). Compare the
    // database names, or every column looks both missing and extra.
    const drizzleColumns = getTableColumns(pgTable);
    const drizzleColumnDbNames = Object.values(drizzleColumns).map(
      (column) => (column as { name: string }).name,
    );
    const drizzleColumnNames = new Set(drizzleColumnDbNames);

    // Check for extra columns in the database that the code doesn't know about
    // (ignoring PostgreSQL system columns like xmin, xmax, ctid, etc.)
    const postgresSystemColumns = new Set(["ctid", "oid", "xmin", "xmax", "cmin", "cmax"]);
    const extraColumns: string[] = [];
    const extraNotNullColumns: string[] = [];

    for (const col of actualColumns) {
      if (!drizzleColumnNames.has(col.column_name) && !postgresSystemColumns.has(col.column_name)) {
        extraColumns.push(col.column_name);
        // Flag NOT NULL columns without defaults as critical (inserts will fail)
        if (col.is_nullable === "NO" && col.column_default === null) {
          extraNotNullColumns.push(col.column_name);
        }
      }
    }

    if (extraNotNullColumns.length > 0) {
      result.issuesFound = true;
      result.extraNotNullColumns.push({
        table: tableName,
        columns: extraNotNullColumns,
      });
    }

    if (extraColumns.length > extraNotNullColumns.length) {
      // There are extra nullable or defaulted columns (less critical but still worth noting)
      const extraNullableOnly = extraColumns.filter(
        (col) => !extraNotNullColumns.includes(col),
      );
      // Still drift, and still reported: the caller only logs anything at all
      // when issuesFound is true, so leaving it false here would print the
      // clean line over a database the code does not match.
      result.issuesFound = true;
      result.extraNullableColumns.push({
        table: tableName,
        columns: extraNullableOnly,
      });
    }

    // Check for missing columns in the database that the code expects
    const missingColumns: string[] = [];

    for (const colName of drizzleColumnDbNames) {
      if (!actualColumnsByName.has(colName)) {
        missingColumns.push(colName);
      }
    }

    if (missingColumns.length > 0) {
      result.issuesFound = true;
      result.missingColumns.push({
        table: tableName,
        columns: missingColumns,
      });
    }
  }

  return result;
}

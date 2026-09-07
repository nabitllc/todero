import { createHash } from "node:crypto";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));
const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
const MIGRATIONS_JOURNAL_JSON = fileURLToPath(new URL("./migrations/meta/_journal.json", import.meta.url));

function createUtilitySql(url: string) {
  return postgres(url, { max: 1, onnotice: () => {} });
}

type RegisteredPostgresClient = ReturnType<typeof postgres>;

/**
 * Derives a registry key from a connection URL's host and port only. We must
 * not retain or log the full URL, because it carries credentials.
 */
function hostPortKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || "5432"}`;
}

/**
 * Same as `hostPortKey`, but returns `null` instead of throwing when the URL
 * does not parse. `postgres(url)` tolerates a value `new URL()` rejects (an
 * empty string falls back to the `PG*` environment variables), so `createDb`
 * must tolerate it too: skip the registry entry and let the driver decide
 * the outcome, instead of throwing an error the driver itself would not.
 */
function hostPortKeyOrNull(url: string): string | null {
  try {
    return hostPortKey(url);
  } catch (error) {
    if (error instanceof TypeError && (error as NodeJS.ErrnoException).code === "ERR_INVALID_URL") return null;
    throw error;
  }
}

// Tracks every client `createDb` hands out, keyed by host and port, so a test
// fixture can end them before it stops the Postgres cluster they point at. A
// `WeakRef` plus `FinalizationRegistry` means a long-lived process (a real
// server) retains nothing extra: an unreferenced client is pruned on its own.
const clientsByHostPort = new Map<string, Set<WeakRef<RegisteredPostgresClient>>>();
const clientFinalizer = new FinalizationRegistry<{ hostPortKey: string; ref: WeakRef<RegisteredPostgresClient> }>(
  ({ hostPortKey, ref }) => {
    const refs = clientsByHostPort.get(hostPortKey);
    if (!refs) return;
    refs.delete(ref);
    if (refs.size === 0) clientsByHostPort.delete(hostPortKey);
  },
);

function registerClient(key: string, client: RegisteredPostgresClient): void {
  const ref = new WeakRef(client);
  let refs = clientsByHostPort.get(key);
  if (!refs) {
    refs = new Set();
    clientsByHostPort.set(key, refs);
  }
  refs.add(ref);
  clientFinalizer.register(client, { hostPortKey: key, ref }, ref);
}

/**
 * Ends every live client `createDb` handed out for the given URL's host and
 * port, then forgets them. Call this before stopping a Postgres cluster: a
 * client that outlives the cluster it points at can crash the process (a
 * reserved connection's deferred write firing after the socket is gone).
 * Swallows individual `end()` errors so one bad client cannot block the rest.
 */
export async function closeRegisteredClients(url: string): Promise<void> {
  const key = hostPortKey(url);
  const refs = clientsByHostPort.get(key);
  if (!refs) return;

  clientsByHostPort.delete(key);
  const clients: RegisteredPostgresClient[] = [];
  for (const ref of refs) {
    clientFinalizer.unregister(ref);
    const client = ref.deref();
    if (client) clients.push(client);
  }

  await Promise.all(clients.map((client) => client.end({ timeout: 1 }).catch(() => {})));
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function quoteIdentifier(value: string): string {
  if (!isSafeIdentifier(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function splitMigrationStatements(content: string): string[] {
  return content
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Counts `;` characters that terminate an actual top-level SQL statement,
 * ignoring semicolons inside a single-quoted string literal or a
 * dollar-quoted block (`$$ ... $$` / `$tag$ ... $tag$`, used by `DO` blocks
 * and function bodies) — those are payload, not statement separators. A
 * `splitMigrationStatements` element with more than one of these is not one
 * statement: it is a whole migration file (or a run of several statements)
 * that never got a `--> statement-breakpoint` between them, so the regex
 * checks below — each anchored to a single DDL shape — must not be allowed
 * to match against just the *first* of several unrelated statements and
 * silently decide the fate of all the others (see PR #48 Blocker 2:
 * `0182_connections_v3_schema_core.sql`, no markers, 10 statements, verified
 * "applied" by its `CREATE TABLE`'s column check alone).
 */
function countTopLevelStatementSeparators(text: string): number {
  let count = 0;
  let inSingleQuote = false;
  let dollarTag: string | null = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i += 1;
      continue;
    }
    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      i += 1;
      continue;
    }
    if (ch === "$") {
      const tagMatch = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (tagMatch) {
        dollarTag = tagMatch[0];
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ";") count += 1;
    i += 1;
  }
  return count;
}

/**
 * `true` when a `splitMigrationStatements` element is really more than one
 * SQL statement glued together by a missing `--> statement-breakpoint`. See
 * `countTopLevelStatementSeparators`. Exported for the migration corpus lint
 * test (`client.test.ts`), which reports — but does not enforce zero, since
 * this fix does not rewrite the 232 pre-existing migration files — how many
 * of them still have this shape.
 */
export function statementContainsMultipleTopLevelStatements(statement: string): boolean {
  return countTopLevelStatementSeparators(statement) > 1;
}

const defaultSchemaByClient = new WeakMap<object, Promise<string>>();

/**
 * The schema `migrationStatementAlreadyApplied`'s checks fall back to when a
 * statement does not schema-qualify the object it targets — e.g. `CREATE
 * TABLE "t" (...)` rather than `CREATE TABLE "myschema"."t" (...)`. Almost
 * every statement in this codebase's migrations is unqualified and relies on
 * `search_path`, so the *correct* default is whatever `current_schema()`
 * resolves to for this connection, not a hardcoded `'public'` — a
 * self-hosted deployment or a per-plugin schema (see `plugin_database.ts`'s
 * `namespace_mode: "schema"`) can run with a different `search_path`.
 * Memoized per `sql` client because it never changes for the lifetime of a
 * connection and every existence check needs it.
 */
async function resolveDefaultSchema(sql: ReturnType<typeof postgres>): Promise<string> {
  const cached = defaultSchemaByClient.get(sql);
  if (cached) return cached;

  const resolved = sql<{ schema: string }[]>`SELECT current_schema() AS schema`.then(
    (rows) => rows[0]?.schema ?? "public",
  );
  // Cache the resolved value, not the in-flight promise: a transient query
  // failure (a connection blip) must not permanently poison every later
  // check against this same connection with the same rejection.
  const schema = await resolved;
  defaultSchemaByClient.set(sql, Promise.resolve(schema));
  return schema;
}

/**
 * Normalizes a DDL fragment (either the original migration statement or a
 * `pg_get_indexdef` / `pg_get_constraintdef` rendering) so the two can be
 * compared for structural equality despite Postgres re-serializing
 * identifiers, spacing, and redundant parentheses on read (`CHECK (x is not
 * null)` round-trips as `CHECK ((x IS NOT NULL))`). Parentheses are stripped
 * entirely rather than merely collapsed: since the same transform is applied
 * to both sides before comparing, this only risks a false match where two
 * *differently* parenthesized expressions collapse to the same token stream,
 * which is not a shape this codebase's migrations produce (see
 * `client.test.ts`'s DDL-comparison unit cases). Schema-qualification is
 * stripped for the resolved default schema only, so a same-schema comparison
 * is qualifier-insensitive without erasing a genuinely different schema.
 */
function normalizeDdlText(text: string, schemaName: string): string {
  const schemaPrefix = new RegExp(`\\b${escapeRegExp(schemaName.toLowerCase())}\\.`, "g");
  return text
    .toLowerCase()
    .replace(/"/g, "")
    .replace(schemaPrefix, "")
    .replace(/\bif not exists\b/g, "")
    .replace(/\bon update no action\b/g, "")
    .replace(/\bon delete no action\b/g, "")
    .replace(/[()]/g, "")
    .replace(/;\s*$/, "")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Postgres SQLSTATE 23505: unique_violation. */
function isUniqueViolationError(error: unknown): boolean {
  return errorCode(error) === "23505";
}

/** Postgres SQLSTATE 42P01: undefined_table. */
function isUndefinedTableError(error: unknown): boolean {
  return errorCode(error) === "42P01";
}

export type MigrationState =
  | {
      status: "upToDate";
      tableCount: number;
      availableMigrations: string[];
      appliedMigrations: string[];
      journalEntryCount: number;
    }
  | {
      status: "needsMigrations";
      tableCount: number;
      availableMigrations: string[];
      appliedMigrations: string[];
      pendingMigrations: string[];
      journalEntryCount: number;
      reason: "no-migration-journal-empty-db" | "no-migration-journal-non-empty-db" | "pending-migrations";
    };

export interface DatabaseClientOptions {
  /**
   * postgres.js `prepare`. Set false when connecting through a
   * transaction-mode pooler (pgbouncer / Neon `-pooler` endpoints /
   * Supabase Supavisor transaction ports) so the client does not rely on
   * session-scoped prepared statements. Defaults to the driver default
   * (enabled), preserving existing behavior on direct connections.
   */
  prepare?: boolean;
  /** postgres.js `max` — connection pool size (driver default: 10). */
  maxConnections?: number;
  /** postgres.js `idle_timeout` in seconds (driver default: disabled). */
  idleTimeoutSeconds?: number;
  /** postgres.js `connect_timeout` in seconds (driver default: 30). */
  connectTimeoutSeconds?: number;
}

function envBoolean(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const value = env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be "true" or "false", got: ${env[name]}`);
}

function envPositiveInteger(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer, got: ${env[name]}`);
  }
  return Number.parseInt(value, 10);
}

/**
 * Database client tuning from the environment, so hosted deployments can
 * adapt to their connection topology (pooled endpoints, network latency)
 * without editing source. Every variable is optional; when unset the
 * driver defaults apply and behavior is identical to a bare
 * `postgres(url)` — self-hosted setups need none of these.
 */
export function databaseClientOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseClientOptions {
  const options: DatabaseClientOptions = {};
  const prepare = envBoolean(env, "DATABASE_PREPARED_STATEMENTS");
  if (prepare !== undefined) options.prepare = prepare;
  const maxConnections = envPositiveInteger(env, "DATABASE_POOL_MAX");
  if (maxConnections !== undefined) options.maxConnections = maxConnections;
  const idleTimeoutSeconds = envPositiveInteger(env, "DATABASE_IDLE_TIMEOUT_SECONDS");
  if (idleTimeoutSeconds !== undefined) options.idleTimeoutSeconds = idleTimeoutSeconds;
  const connectTimeoutSeconds = envPositiveInteger(env, "DATABASE_CONNECT_TIMEOUT_SECONDS");
  if (connectTimeoutSeconds !== undefined) options.connectTimeoutSeconds = connectTimeoutSeconds;
  return options;
}

export function postgresJsOptions(options: DatabaseClientOptions): Record<string, unknown> {
  const driverOptions: Record<string, unknown> = {};
  if (options.prepare !== undefined) driverOptions.prepare = options.prepare;
  if (options.maxConnections !== undefined) driverOptions.max = options.maxConnections;
  if (options.idleTimeoutSeconds !== undefined) driverOptions.idle_timeout = options.idleTimeoutSeconds;
  if (options.connectTimeoutSeconds !== undefined) driverOptions.connect_timeout = options.connectTimeoutSeconds;
  return driverOptions;
}

export function createDb(url: string, options?: DatabaseClientOptions) {
  const resolved = options ?? databaseClientOptionsFromEnv();
  const sql = postgres(url, postgresJsOptions(resolved));
  const key = hostPortKeyOrNull(url);
  if (key) registerClient(key, sql);
  return drizzlePg(sql, { schema });
}

export async function getPostgresDataDirectory(url: string): Promise<string | null> {
  const sql = createUtilitySql(url);
  try {
    const rows = await sql<{ data_directory: string | null }[]>`
      SELECT current_setting('data_directory', true) AS data_directory
    `;
    const actual = rows[0]?.data_directory;
    return typeof actual === "string" && actual.length > 0 ? actual : null;
  } catch {
    return null;
  } finally {
    await sql.end();
  }
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_FOLDER, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

type MigrationJournalFile = {
  entries?: Array<{ idx?: number; tag?: string; when?: number }>;
};

type JournalMigrationEntry = {
  fileName: string;
  folderMillis: number;
  order: number;
};

async function listJournalMigrationEntries(): Promise<JournalMigrationEntry[]> {
  try {
    const raw = await readFile(MIGRATIONS_JOURNAL_JSON, "utf8");
    const parsed = JSON.parse(raw) as MigrationJournalFile;
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .map((entry, entryIndex) => {
        if (typeof entry?.tag !== "string") return null;
        if (typeof entry?.when !== "number" || !Number.isFinite(entry.when)) return null;
        const order = Number.isInteger(entry.idx) ? Number(entry.idx) : entryIndex;
        return { fileName: `${entry.tag}.sql`, folderMillis: entry.when, order };
      })
      .filter((entry): entry is JournalMigrationEntry => entry !== null);
  } catch {
    return [];
  }
}

async function listJournalMigrationFiles(): Promise<string[]> {
  const entries = await listJournalMigrationEntries();
  return entries.map((entry) => entry.fileName);
}

async function readMigrationFileContent(migrationFile: string): Promise<string> {
  return readFile(new URL(`./migrations/${migrationFile}`, import.meta.url), "utf8");
}

async function orderMigrationsByJournal(migrationFiles: string[]): Promise<string[]> {
  const journalEntries = await listJournalMigrationEntries();
  const orderByFileName = new Map(journalEntries.map((entry) => [entry.fileName, entry.order]));
  return [...migrationFiles].sort((left, right) => {
    const leftOrder = orderByFileName.get(left);
    const rightOrder = orderByFileName.get(right);
    if (leftOrder === undefined && rightOrder === undefined) return left.localeCompare(right);
    if (leftOrder === undefined) return 1;
    if (rightOrder === undefined) return -1;
    if (leftOrder === rightOrder) return left.localeCompare(right);
    return leftOrder - rightOrder;
  });
}

type SqlExecutor = Pick<ReturnType<typeof postgres>, "unsafe">;

async function runInTransaction(sql: SqlExecutor, action: () => Promise<void>): Promise<void> {
  await sql.unsafe("BEGIN");
  try {
    await action();
    await sql.unsafe("COMMIT");
  } catch (error) {
    try {
      await sql.unsafe("ROLLBACK");
    } catch {
      // Ignore rollback failures and surface the original error.
    }
    throw error;
  }
}

async function latestMigrationCreatedAt(
  sql: SqlExecutor,
  qualifiedTable: string,
): Promise<number | null> {
  const rows = await sql.unsafe<{ created_at: string | number | null }[]>(
    `SELECT created_at FROM ${qualifiedTable} ORDER BY created_at DESC NULLS LAST LIMIT 1`,
  );
  const value = Number(rows[0]?.created_at ?? Number.NaN);
  return Number.isFinite(value) ? value : null;
}

function normalizeFolderMillis(value: number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  return Date.now();
}

async function ensureMigrationJournalTable(
  sql: ReturnType<typeof postgres>,
): Promise<{ migrationTableSchema: string; columnNames: Set<string> }> {
  let migrationTableSchema = await discoverMigrationTableSchema(sql);
  if (!migrationTableSchema) {
    const drizzleSchema = quoteIdentifier("drizzle");
    const migrationTable = quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE);
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${drizzleSchema}`);
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${drizzleSchema}.${migrationTable} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    migrationTableSchema = (await discoverMigrationTableSchema(sql)) ?? "drizzle";
  }

  const columnNames = await getMigrationTableColumnNames(sql, migrationTableSchema);
  return { migrationTableSchema, columnNames };
}

async function migrationHistoryEntryExists(
  sql: SqlExecutor,
  qualifiedTable: string,
  columnNames: Set<string>,
  migrationFile: string,
  hash: string,
): Promise<boolean> {
  const predicates: string[] = [];
  if (columnNames.has("hash")) predicates.push(`hash = ${quoteLiteral(hash)}`);
  if (columnNames.has("name")) predicates.push(`name = ${quoteLiteral(migrationFile)}`);
  if (predicates.length === 0) return false;

  const rows = await sql.unsafe<{ one: number }[]>(
    `SELECT 1 AS one FROM ${qualifiedTable} WHERE ${predicates.join(" OR ")} LIMIT 1`,
  );
  return rows.length > 0;
}

async function recordMigrationHistoryEntry(
  sql: SqlExecutor,
  qualifiedTable: string,
  columnNames: Set<string>,
  migrationFile: string,
  hash: string,
  folderMillis: number,
): Promise<void> {
  const insertColumns: string[] = [];
  const insertValues: string[] = [];

  if (columnNames.has("hash")) {
    insertColumns.push(quoteIdentifier("hash"));
    insertValues.push(quoteLiteral(hash));
  }
  if (columnNames.has("name")) {
    insertColumns.push(quoteIdentifier("name"));
    insertValues.push(quoteLiteral(migrationFile));
  }
  if (columnNames.has("created_at")) {
    const latestCreatedAt = await latestMigrationCreatedAt(sql, qualifiedTable);
    const createdAt = latestCreatedAt === null
      ? normalizeFolderMillis(folderMillis)
      : Math.max(latestCreatedAt + 1, normalizeFolderMillis(folderMillis));
    insertColumns.push(quoteIdentifier("created_at"));
    insertValues.push(quoteLiteral(String(createdAt)));
  }

  if (insertColumns.length === 0) return;

  await sql.unsafe(
    `INSERT INTO ${qualifiedTable} (${insertColumns.join(", ")}) VALUES (${insertValues.join(", ")})`,
  );
}

function statementPreview(statement: string): string {
  const collapsed = statement.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

export type SkippedMigrationStatement = {
  migrationFile: string;
  statementPreview: string;
  reason: string;
};

function logSkippedStatement(skipped: SkippedMigrationStatement): void {
  console.info(
    `[todero-db] Skipped statement in ${skipped.migrationFile} (${skipped.reason}): ${skipped.statementPreview}`,
  );
}

async function applyPendingMigrationsManually(
  url: string,
  pendingMigrations: string[],
): Promise<SkippedMigrationStatement[]> {
  if (pendingMigrations.length === 0) return [];

  const orderedPendingMigrations = await orderMigrationsByJournal(pendingMigrations);
  const journalEntries = await listJournalMigrationEntries();
  const folderMillisByFileName = new Map(
    journalEntries.map((entry) => [entry.fileName, normalizeFolderMillis(entry.folderMillis)]),
  );
  const skippedStatements: SkippedMigrationStatement[] = [];

  const sql = createUtilitySql(url);
  try {
    const { migrationTableSchema, columnNames } = await ensureMigrationJournalTable(sql);
    const qualifiedTable = `${quoteIdentifier(migrationTableSchema)}.${quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}`;

    for (const migrationFile of orderedPendingMigrations) {
      const migrationContent = await readMigrationFileContent(migrationFile);
      const hash = createHash("sha256").update(migrationContent).digest("hex");
      const existingEntry = await migrationHistoryEntryExists(
        sql,
        qualifiedTable,
        columnNames,
        migrationFile,
        hash,
      );
      if (existingEntry) continue;

      await runInTransaction(sql, async () => {
        const statements = splitMigrationStatements(migrationContent);
        // A migration this codebase could not reconcile wholesale (see
        // `migrationContentAlreadyApplied`) can still be *partially*
        // applied — its DDL ran in a prior attempt but a later statement in
        // the same file failed, or drizzle's journal simply lost track of
        // an already-applied file (the drift this whole reconciliation
        // path exists for). Replaying every statement unconditionally is
        // what turns that into a crash (`relation already exists`) instead
        // of a repair, so DDL statements independently verified as already
        // applied are skipped. Statements this file's own author could not
        // make independently verifiable (data backfills, `DO $$ ... $$`
        // blocks) still run every time, exactly as before this function
        // gained per-statement granularity: this codebase's migrations are
        // written to tolerate that (`WHERE x IS NULL` guards, `IF NOT
        // EXISTS` checks inside the block, deterministic recomputation) —
        // see `client.test.ts`'s "replays migration 0134 ..." and "replays
        // the built-in managed resources migration ..." cases, both of
        // which depend on an unrecognized statement running unconditionally
        // even when other statements in the same file are already applied.
        for (const statement of statements) {
          const state = await migrationStatementAlreadyApplied(sql, statement);
          if (state === "applied") {
            const skipped: SkippedMigrationStatement = {
              migrationFile,
              statementPreview: statementPreview(statement),
              reason: "already-applied",
            };
            skippedStatements.push(skipped);
            logSkippedStatement(skipped);
            continue;
          }

          if (state === "unrecognized") {
            // An unrecognized statement (a data backfill/repair this
            // process cannot verify against the live schema) reaches DML
            // here that may never have run before — see PR #48 Critical 3.
            // This codebase's own such statements are written to tolerate
            // replay, but a *non-idempotent* one (an `INSERT ... SELECT`
            // with no `ON CONFLICT`, replayed against a unique index) can
            // hit a unique violation on a database where the row it would
            // have inserted already exists from an earlier, successful run
            // of this same statement. A savepoint scopes that possibility:
            // 23505 rolls back to before the statement and is treated as
            // "this row's effect is already present" (an audited skip, not
            // a silent one); any other error still fails the whole
            // migration loudly, exactly as before.
            const savepoint = "todero_unrecognized_statement_replay";
            await sql.unsafe(`SAVEPOINT ${savepoint}`);
            try {
              await sql.unsafe(statement);
              await sql.unsafe(`RELEASE SAVEPOINT ${savepoint}`);
            } catch (error) {
              if (!isUniqueViolationError(error)) throw error;
              await sql.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              await sql.unsafe(`RELEASE SAVEPOINT ${savepoint}`);
              const skipped: SkippedMigrationStatement = {
                migrationFile,
                statementPreview: statementPreview(statement),
                reason: "unique-violation-treated-as-already-applied",
              };
              skippedStatements.push(skipped);
              logSkippedStatement(skipped);
            }
            continue;
          }

          await sql.unsafe(statement);
        }

        await recordMigrationHistoryEntry(
          sql,
          qualifiedTable,
          columnNames,
          migrationFile,
          hash,
          folderMillisByFileName.get(migrationFile) ?? Date.now(),
        );
      });
    }
  } finally {
    await sql.end();
  }

  return skippedStatements;
}

async function mapHashesToMigrationFiles(migrationFiles: string[]): Promise<Map<string, string>> {
  const mapped = new Map<string, string>();

  await Promise.all(
    migrationFiles.map(async (migrationFile) => {
      const content = await readMigrationFileContent(migrationFile);
      const hash = createHash("sha256").update(content).digest("hex");
      mapped.set(hash, migrationFile);
    }),
  );

  return mapped;
}

async function getMigrationTableColumnNames(
  sql: ReturnType<typeof postgres>,
  migrationTableSchema: string,
): Promise<Set<string>> {
  const columns = await sql.unsafe<{ column_name: string }[]>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${quoteLiteral(migrationTableSchema)}
        AND table_name = ${quoteLiteral(DRIZZLE_MIGRATIONS_TABLE)}
    `,
  );
  return new Set(columns.map((column) => column.column_name));
}

async function tableExists(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  tableName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ${schemaName}
        AND table_name = ${tableName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

/**
 * Extracts the column names declared directly inside a `CREATE TABLE "x" (
 * ... )` statement — a paren/quote-aware scan of the column-list body, not a
 * regex over the whole statement, because column definitions can themselves
 * contain parens and commas (`numeric(10,2)`, `gen_random_uuid()`, a
 * `DEFAULT` string literal with a comma in it) that a naive split would
 * mistake for the top-level separators between columns.
 */
function extractTopLevelColumnNames(createTableStatement: string): string[] {
  const openIndex = createTableStatement.indexOf("(");
  if (openIndex === -1) return [];

  let depth = 0;
  let inSingleQuote = false;
  let bodyStart = -1;
  let bodyEnd = -1;
  for (let i = openIndex; i < createTableStatement.length; i += 1) {
    const ch = createTableStatement[i];
    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      if (depth === 1) bodyStart = i + 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  if (bodyStart === -1 || bodyEnd === -1) return [];

  const body = createTableStatement.slice(bodyStart, bodyEnd);
  const segments: string[] = [];
  let segmentStart = 0;
  let segmentDepth = 0;
  let segmentInSingleQuote = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (segmentInSingleQuote) {
      if (ch === "'") segmentInSingleQuote = false;
      continue;
    }
    if (ch === "'") {
      segmentInSingleQuote = true;
      continue;
    }
    if (ch === "(") segmentDepth += 1;
    else if (ch === ")") segmentDepth -= 1;
    else if (ch === "," && segmentDepth === 0) {
      segments.push(body.slice(segmentStart, i));
      segmentStart = i + 1;
    }
  }
  segments.push(body.slice(segmentStart));

  const columnNames: string[] = [];
  for (const segment of segments) {
    const match = segment.trim().match(/^"([^"]+)"/);
    if (match) columnNames.push(match[1]);
  }
  return columnNames;
}

/**
 * Existence is not enough for `CREATE TABLE`: a table of the same name can
 * already exist with a materially different shape (the exact drift this
 * whole reconciliation path exists to detect — see `environments`, which
 * predates a `company_id` column the current migration's `CREATE TABLE`
 * declares). Verify every column the statement declares is present, not just
 * that a table with this name is present.
 */
async function tableExistsWithColumns(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  tableName: string,
  createTableStatement: string,
): Promise<boolean> {
  if (!(await tableExists(sql, schemaName, tableName))) return false;

  const declaredColumns = extractTopLevelColumnNames(createTableStatement);
  if (declaredColumns.length === 0) return true;

  const rows = await sql.unsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = ${quoteLiteral(schemaName)} AND table_name = ${quoteLiteral(tableName)}`,
  );
  const existingColumns = new Set(rows.map((row) => row.column_name));
  return declaredColumns.every((column) => existingColumns.has(column));
}

async function columnExists(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function columnHasDataType(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  tableName: string,
  columnName: string,
  dataType: string,
): Promise<boolean> {
  const rows = await sql<{ dataType: string; udtName: string }[]>`
    SELECT data_type AS "dataType", udt_name AS "udtName"
    FROM information_schema.columns
    WHERE table_schema = ${schemaName}
      AND table_name = ${tableName}
      AND column_name = ${columnName}
  `;
  const expected = dataType.toLowerCase();
  return rows.some((row) => (
    row.dataType.toLowerCase() === expected || row.udtName.toLowerCase() === expected
  ));
}

/**
 * Existence-only check, matching the philosophy of `indexExists` /
 * `constraintExists` / `functionExists` below: we verify a default has been
 * set on the column at all, not that its expression text matches the
 * migration byte-for-byte. Postgres re-serializes default expressions (adds
 * casts, reorders parens) on read, so exact-text comparison would reject
 * defaults that are semantically identical to what the migration set.
 */
async function columnHasDefault(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = await sql<{ columnDefault: string | null }[]>`
    SELECT column_default AS "columnDefault"
    FROM information_schema.columns
    WHERE table_schema = ${schemaName}
      AND table_name = ${tableName}
      AND column_name = ${columnName}
  `;
  return rows.some((row) => row.columnDefault !== null);
}

async function indexExists(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  indexName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schemaName}
        AND c.relkind = 'i'
        AND c.relname = ${indexName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

/**
 * Tri-state: an index of that name existing under a *different* definition
 * (different columns, uniqueness, or predicate) than the statement declares
 * is not proof the migration's effect is present — see PR #48 Critical 4.
 * Comparing `pg_get_indexdef`'s rendering against the statement (both passed
 * through `normalizeDdlText`) tells applied-with-matching-shape apart from
 * merely-same-name.
 */
async function indexMatchesStatement(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  indexName: string,
  statement: string,
): Promise<StatementApplyState> {
  const rows = await sql<{ indexdef: string }[]>`
    SELECT pg_get_indexdef(c.oid) AS indexdef
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schemaName}
      AND c.relkind = 'i'
      AND c.relname = ${indexName}
  `;
  if (rows.length === 0) return "not-applied";
  const actual = normalizeDdlText(rows[0].indexdef, schemaName);
  const expected = normalizeDdlText(statement, schemaName);
  return actual === expected ? "applied" : "unrecognized";
}

async function constraintExists(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  tableName: string,
  constraintName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${schemaName}
        AND t.relname = ${tableName}
        AND c.conname = ${constraintName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

/**
 * Tri-state counterpart of `constraintExists`, scoped by `conrelid` (the
 * owning table), not name alone — see PR #48 Critical 4. A same-named
 * constraint on the same table but a different definition (columns, FK
 * target, `ON DELETE` action, check expression) must not read as "applied":
 * it means the *statement's* effect is not present, only something with the
 * same name is.
 */
async function constraintMatchesStatement(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  tableName: string,
  constraintName: string,
  statementConstraintDefinition: string,
): Promise<StatementApplyState> {
  const rows = await sql<{ definition: string }[]>`
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = ${schemaName}
      AND t.relname = ${tableName}
      AND c.conname = ${constraintName}
  `;
  if (rows.length === 0) return "not-applied";
  const actual = normalizeDdlText(rows[0].definition, schemaName);
  const expected = normalizeDdlText(statementConstraintDefinition, schemaName);
  return actual === expected ? "applied" : "unrecognized";
}

async function functionExists(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  functionName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ${schemaName}
        AND p.proname = ${functionName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function triggerExists(
  sql: ReturnType<typeof postgres>,
  schemaName: string,
  triggerName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schemaName}
        AND t.tgname = ${triggerName}
        AND NOT t.tgisinternal
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function heartbeatNextEventSequencesAreCurrent(
  sql: ReturnType<typeof postgres>,
): Promise<boolean> {
  const rows = await sql<{ current: boolean }[]>`
    SELECT NOT EXISTS (
      SELECT 1
      FROM heartbeat_runs run
      WHERE run.next_event_seq IS DISTINCT FROM COALESCE((
        SELECT max(event.seq) + 1
        FROM heartbeat_run_events event
        WHERE event.run_id = run.id
      ), 1)
    ) AS current
  `;
  return rows[0]?.current ?? false;
}

/**
 * Tri-state rather than boolean: `"unrecognized"` (a statement shape we have
 * no read-only check for, e.g. a data backfill `UPDATE`) is a distinct
 * outcome from `"not-applied"` (a statement shape we understand, checked
 * against the live schema, and it has genuinely not run yet). Collapsing
 * these to a single `false` is what let a legacy migration containing one
 * unrecognized statement fall back to a full, destructive replay even when
 * every DDL effect in that same file was already present. See
 * `migrationContentAlreadyApplied` for how the two are told apart.
 */
type StatementApplyState = "applied" | "not-applied" | "unrecognized";

// Optional schema-qualification prefix on a table/index reference, e.g. the
// `"myschema".` in `"myschema"."widgets"` — see PR #48 Critical 4 / Minor 12.
// Capturing it as its own optional group (rather than the single greedy
// `"([^"]+)"` the first pass used) matters: unqualified, `"([^"]+)"` matches
// the *first* quoted identifier it sees, so `"public"."t"` used to capture
// `public` as the table name instead of `t`.
const SCHEMA_PREFIX = '(?:"([^"]+)"\\.)?';

/**
 * `false` when a normalized `ALTER TABLE` statement contains more than one
 * `ADD COLUMN` / `DROP COLUMN` clause (`... DROP COLUMN "a", DROP COLUMN
 * "b"`) — see PR #48 finding 7. Deliberately a clause count, not an
 * end-of-statement anchor: `ADD COLUMN` (and `ALTER COLUMN ... SET DATA
 * TYPE`) are always followed by a data type, so anchoring the match itself
 * to end right after the column name would misjudge every real single-column
 * `ADD COLUMN "x" text` statement in the corpus as unrecognized.
 */
function alterTableHasSingleColumnClause(normalized: string): boolean {
  const columnClauseCount = (normalized.match(/\b(?:ADD|DROP)\s+COLUMN\b/gi) ?? []).length;
  return columnClauseCount <= 1;
}

async function migrationStatementAlreadyApplied(
  sql: ReturnType<typeof postgres>,
  statement: string,
): Promise<StatementApplyState> {
  const normalized = statement
    .replace(/^\s*--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  // A `splitMigrationStatements` element containing more than one top-level
  // `;` is several SQL statements with no `--> statement-breakpoint` between
  // them (see PR #48 Blocker 2). None of the single-shape regexes below may
  // be allowed to match against just the head of that blob and decide the
  // fate of the statements after it.
  if (statementContainsMultipleTopLevelStatements(normalized)) {
    return "unrecognized";
  }

  const applied = (value: boolean): StatementApplyState => (value ? "applied" : "not-applied");
  const schemaOrDefault = async (captured: string | undefined): Promise<string> =>
    captured ?? (await resolveDefaultSchema(sql));

  const createTableMatch = normalized.match(
    new RegExp(`^CREATE TABLE(?: IF NOT EXISTS)? ${SCHEMA_PREFIX}"([^"]+)"`, "i"),
  );
  if (createTableMatch) {
    const schemaName = await schemaOrDefault(createTableMatch[1]);
    return applied(await tableExistsWithColumns(sql, schemaName, createTableMatch[2], normalized));
  }

  // `ALTER TABLE` can chain multiple comma-separated actions in one
  // statement (`DROP COLUMN a, DROP COLUMN b`); this codebase's own
  // migrations never do (verified against the corpus), but a regex anchored
  // only at the *start* would still match just the first action and
  // silently ignore the rest — see PR #48 finding 7's multi-clause case.
  // `alterTableHasSingleColumnClause` guards against that without anchoring
  // the end of the match itself, which — unlike `DROP COLUMN`/`DROP
  // INDEX` — is not safe for `ADD COLUMN`/`ALTER COLUMN ... SET DATA TYPE`:
  // both are always followed by a data type (`ADD COLUMN "x" text`), so
  // requiring nothing else after the column name would misjudge every real
  // `ADD COLUMN` statement in the corpus as unrecognized.
  const addColumnMatch = normalized.match(
    new RegExp(`^ALTER TABLE ${SCHEMA_PREFIX}"([^"]+)" ADD COLUMN(?: IF NOT EXISTS)? "([^"]+)"`, "i"),
  );
  if (addColumnMatch) {
    if (!alterTableHasSingleColumnClause(normalized)) return "unrecognized";
    const schemaName = await schemaOrDefault(addColumnMatch[1]);
    return applied(await columnExists(sql, schemaName, addColumnMatch[2], addColumnMatch[3]));
  }

  const dropColumnMatch = normalized.match(
    new RegExp(`^ALTER TABLE ${SCHEMA_PREFIX}"([^"]+)" DROP COLUMN(?: IF EXISTS)? "([^"]+)"`, "i"),
  );
  if (dropColumnMatch) {
    if (!alterTableHasSingleColumnClause(normalized)) return "unrecognized";
    const schemaName = await schemaOrDefault(dropColumnMatch[1]);
    return applied(!(await columnExists(sql, schemaName, dropColumnMatch[2], dropColumnMatch[3])));
  }

  const alterColumnTypeMatch = normalized.match(
    new RegExp(`^ALTER TABLE ${SCHEMA_PREFIX}"([^"]+)" ALTER COLUMN "([^"]+)" SET DATA TYPE ([A-Za-z0-9_]+)\\s*;?\\s*$`, "i"),
  );
  if (alterColumnTypeMatch) {
    const schemaName = await schemaOrDefault(alterColumnTypeMatch[1]);
    return applied(await columnHasDataType(
      sql,
      schemaName,
      alterColumnTypeMatch[2],
      alterColumnTypeMatch[3],
      alterColumnTypeMatch[4],
    ));
  }

  const alterColumnDefaultMatch = normalized.match(
    new RegExp(`^ALTER TABLE ${SCHEMA_PREFIX}"([^"]+)" ALTER COLUMN "([^"]+)" SET DEFAULT `, "i"),
  );
  if (alterColumnDefaultMatch) {
    const schemaName = await schemaOrDefault(alterColumnDefaultMatch[1]);
    return applied(await columnHasDefault(sql, schemaName, alterColumnDefaultMatch[2], alterColumnDefaultMatch[3]));
  }

  // `CREATE INDEX` never schema-qualifies the index name itself (an index
  // always lives in its table's schema) — the optional prefix here is on the
  // table reference after `ON`. Verified against `pg_get_indexdef`, not name
  // alone: see PR #48 Critical 4 (`indexMatchesStatement`).
  const createIndexMatch = normalized.match(
    new RegExp(`^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "([^"]+)" ON ${SCHEMA_PREFIX}"([^"]+)"`, "i"),
  );
  if (createIndexMatch) {
    const schemaName = await schemaOrDefault(createIndexMatch[2]);
    return indexMatchesStatement(sql, schemaName, createIndexMatch[1], normalized);
  }

  // Unlike `CREATE INDEX`, `DROP INDEX` syntax does allow schema-qualifying
  // the index name directly.
  const dropIndexMatch = normalized.match(
    new RegExp(`^DROP INDEX(?: IF EXISTS)? ${SCHEMA_PREFIX}"([^"]+)"\\s*;?\\s*$`, "i"),
  );
  if (dropIndexMatch) {
    const schemaName = await schemaOrDefault(dropIndexMatch[1]);
    return applied(!(await indexExists(sql, schemaName, dropIndexMatch[2])));
  }

  const addConstraintMatch = normalized.match(
    new RegExp(`^ALTER TABLE ${SCHEMA_PREFIX}"([^"]+)" ADD CONSTRAINT "([^"]+)" (.+)$`, "i"),
  );
  if (addConstraintMatch) {
    const schemaName = await schemaOrDefault(addConstraintMatch[1]);
    return constraintMatchesStatement(
      sql,
      schemaName,
      addConstraintMatch[2],
      addConstraintMatch[3],
      addConstraintMatch[4],
    );
  }

  const createFunctionMatch = normalized.match(
    new RegExp(`^CREATE OR REPLACE FUNCTION ${SCHEMA_PREFIX}"?([A-Za-z_][A-Za-z0-9_]*)"?\\s*\\(`, "i"),
  );
  if (createFunctionMatch) {
    const schemaName = await schemaOrDefault(createFunctionMatch[1]);
    return applied(await functionExists(sql, schemaName, createFunctionMatch[2]));
  }

  const createTriggerMatch = normalized.match(
    /^CREATE TRIGGER "?([A-Za-z_][A-Za-z0-9_]*)"?/i,
  );
  if (createTriggerMatch) {
    const schemaName = await resolveDefaultSchema(sql);
    return applied(await triggerExists(sql, schemaName, createTriggerMatch[1]));
  }

  // This native-runner cursor backfill has a persistent postcondition. Verify it
  // instead of replaying it when a restored database is missing only the
  // migration-history row. `heartbeat_runs` itself may not exist yet on a
  // database earlier in reconciliation than this migration's real position
  // (PR #48 Minor 11): that is a signal we cannot read, not proof either way.
  if (
    normalized.startsWith('UPDATE "heartbeat_runs" AS run')
    && normalized.includes('SET "next_event_seq" = COALESCE')
  ) {
    try {
      return applied(await heartbeatNextEventSequencesAreCurrent(sql));
    } catch (error) {
      if (isUndefinedTableError(error)) return "unrecognized";
      throw error;
    }
  }

  // A statement shape with no read-only check (typically a data backfill
  // `UPDATE`/`INSERT`/`WITH ... UPDATE`). Not proof the migration ran, but
  // not proof it didn't either — `migrationContentAlreadyApplied` decides
  // what to do with that absence of signal.
  return "unrecognized";
}

/**
 * Whole-file reconciliation gate for `reconcilePendingMigrationHistory`: this
 * must stay strict, requiring *every* statement to be independently
 * verified `"applied"`, because it is the path that records a migration as
 * done *without running anything*. A migration whose backfill/repair DML
 * cannot be verified (an `"unrecognized"` statement — see
 * `migrationStatementAlreadyApplied`) must not be waved through on the
 * strength of some unrelated, already-applied DDL statement elsewhere in
 * the same file: the DDL being present does not prove the DML's effect
 * still holds for every row, since rows can be inserted after the DDL ran
 * and before this reconciliation runs (`client.test.ts`'s "replays
 * migration 0134" case is exactly this — a fresh row inserted after the
 * initial migration, needing the backfill re-applied to it). Such files
 * correctly report `false` here and fall through to
 * `applyPendingMigrationsManually`, whose per-statement loop skips only the
 * independently-verified-applied statements and always (re-)runs the rest —
 * safe, because this codebase's data migrations are written to tolerate
 * replay (`WHERE x IS NULL` guards, `IF NOT EXISTS` checks, deterministic
 * recomputation).
 */
async function migrationContentAlreadyApplied(
  sql: ReturnType<typeof postgres>,
  migrationContent: string,
): Promise<boolean> {
  const statements = splitMigrationStatements(migrationContent);
  if (statements.length === 0) return false;

  for (const statement of statements) {
    const state = await migrationStatementAlreadyApplied(sql, statement);
    if (state !== "applied") return false;
  }

  return true;
}

async function loadAppliedMigrations(
  sql: ReturnType<typeof postgres>,
  migrationTableSchema: string,
  availableMigrations: string[],
): Promise<string[]> {
  const quotedSchema = quoteIdentifier(migrationTableSchema);
  const qualifiedTable = `${quotedSchema}.${quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}`;
  const columnNames = await getMigrationTableColumnNames(sql, migrationTableSchema);

  if (columnNames.has("name")) {
    const rows = await sql.unsafe<{ name: string }[]>(`SELECT name FROM ${qualifiedTable} ORDER BY id`);
    return rows.map((row) => row.name).filter((name): name is string => Boolean(name));
  }

  if (columnNames.has("hash")) {
    const rows = await sql.unsafe<{ hash: string }[]>(`SELECT hash FROM ${qualifiedTable} ORDER BY id`);
    const hashesToMigrationFiles = await mapHashesToMigrationFiles(availableMigrations);
    const appliedFromHashes = rows
      .map((row) => hashesToMigrationFiles.get(row.hash))
      .filter((name): name is string => Boolean(name));

    if (appliedFromHashes.length > 0) {
      // Best-effort: when all hashes resolve, this is authoritative.
      if (appliedFromHashes.length === rows.length) return appliedFromHashes;

      // Partial hash resolution can happen when files have changed; return what we can trust.
      return appliedFromHashes;
    }

    // Fallback only when hashes are unavailable/unresolved.
    if (columnNames.has("created_at")) {
      const journalEntries = await listJournalMigrationEntries();
      if (journalEntries.length > 0) {
        const lastDbRows = await sql.unsafe<{ created_at: string | number | null }[]>(
          `SELECT created_at FROM ${qualifiedTable} ORDER BY created_at DESC LIMIT 1`,
        );
        const lastCreatedAt = Number(lastDbRows[0]?.created_at ?? -1);
        if (Number.isFinite(lastCreatedAt) && lastCreatedAt >= 0) {
          return journalEntries
            .filter((entry) => availableMigrations.includes(entry.fileName))
            .filter((entry) => entry.folderMillis <= lastCreatedAt)
            .map((entry) => entry.fileName)
            .slice(0, rows.length);
        }
      }
    }
  }

  const rows = await sql.unsafe<{ id: number }[]>(`SELECT id FROM ${qualifiedTable} ORDER BY id`);
  const journalMigrationFiles = await listJournalMigrationFiles();
  const appliedFromIds = rows
    .map((row) => journalMigrationFiles[row.id - 1])
    .filter((name): name is string => Boolean(name));
  if (appliedFromIds.length > 0) return appliedFromIds;

  return availableMigrations.slice(0, Math.max(0, rows.length));
}

export type MigrationHistoryReconcileResult = {
  repairedMigrations: string[];
  remainingMigrations: string[];
  skippedStatements: SkippedMigrationStatement[];
};

export async function reconcilePendingMigrationHistory(
  url: string,
): Promise<MigrationHistoryReconcileResult> {
  const state = await inspectMigrations(url);
  if (state.status !== "needsMigrations" || state.reason !== "pending-migrations") {
    return { repairedMigrations: [], remainingMigrations: [], skippedStatements: [] };
  }

  const sql = createUtilitySql(url);
  const repairedMigrations: string[] = [];
  const skippedStatements: SkippedMigrationStatement[] = [];

  try {
    const journalEntries = await listJournalMigrationEntries();
    const folderMillisByFile = new Map(journalEntries.map((entry) => [entry.fileName, entry.folderMillis]));
    const migrationTableSchema = await discoverMigrationTableSchema(sql);
    if (!migrationTableSchema) {
      return { repairedMigrations, remainingMigrations: state.pendingMigrations, skippedStatements };
    }

    const columnNames = await getMigrationTableColumnNames(sql, migrationTableSchema);
    const qualifiedTable = `${quoteIdentifier(migrationTableSchema)}.${quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}`;

    // Journal order, not lexicographic (Important 9) — the two happen to
    // coincide for these zero-padded, sequentially numbered files, but
    // journal order is the ordering this function's own correctness
    // argument depends on.
    const orderedPendingMigrations = await orderMigrationsByJournal(state.pendingMigrations);

    // Blocker 1: once a pending migration cannot be verified applied, no
    // *later* (journal-order) migration may be stamped in this pass either.
    // Real case in this corpus: 0073 re-adds `companies.attachment_max_bytes`
    // (pending, genuinely not-applied — the column is gone), 0229 drops that
    // same column (pending, but its DROP COLUMN IF EXISTS check reads
    // "applied" because the column is already absent). Stamping 0229 alone
    // here would leave 0073 to `applyPendingMigrationsManually` by itself,
    // which blindly replays its ADD COLUMN and permanently re-adds a column
    // the schema no longer declares (see PR #48, commit 1fe8112c's manual
    // repair of exactly this). Leaving *both* pending instead lets
    // `applyPendingMigrationsManually` — journal-ordered, per-statement,
    // idempotent by design — replay 0073 then 0229 back to back in the same
    // pass, converging on the correct end state instead of freezing a
    // half-applied one into the journal.
    let canStampFurther = true;

    for (const migrationFile of orderedPendingMigrations) {
      if (!canStampFurther) {
        const skipped: SkippedMigrationStatement = {
          migrationFile,
          statementPreview: "(whole file)",
          reason: "blocked-by-earlier-unresolved-pending-migration",
        };
        skippedStatements.push(skipped);
        logSkippedStatement(skipped);
        continue;
      }

      const migrationContent = await readMigrationFileContent(migrationFile);
      const alreadyApplied = await migrationContentAlreadyApplied(sql, migrationContent);
      if (!alreadyApplied) {
        canStampFurther = false;
        const skipped: SkippedMigrationStatement = {
          migrationFile,
          statementPreview: statementPreview(
            splitMigrationStatements(migrationContent)[0] ?? migrationContent,
          ),
          reason: "not-fully-verified-applied",
        };
        skippedStatements.push(skipped);
        logSkippedStatement(skipped);
        continue;
      }

      const hash = createHash("sha256").update(migrationContent).digest("hex");
      const folderMillis = folderMillisByFile.get(migrationFile) ?? Date.now();
      const existingByHash = columnNames.has("hash")
        ? await sql.unsafe<{ created_at: string | number | null }[]>(
            `SELECT created_at FROM ${qualifiedTable} WHERE hash = ${quoteLiteral(hash)} ORDER BY created_at DESC LIMIT 1`,
          )
        : [];
      const existingByName = columnNames.has("name")
        ? await sql.unsafe<{ created_at: string | number | null }[]>(
            `SELECT created_at FROM ${qualifiedTable} WHERE name = ${quoteLiteral(migrationFile)} ORDER BY created_at DESC LIMIT 1`,
          )
        : [];
      if (existingByHash.length > 0 || existingByName.length > 0) {
        if (columnNames.has("created_at")) {
          const existingHashCreatedAt = Number(existingByHash[0]?.created_at ?? -1);
          if (existingByHash.length > 0 && Number.isFinite(existingHashCreatedAt) && existingHashCreatedAt < folderMillis) {
            await sql.unsafe(
              `UPDATE ${qualifiedTable} SET created_at = ${quoteLiteral(String(folderMillis))} WHERE hash = ${quoteLiteral(hash)} AND created_at < ${quoteLiteral(String(folderMillis))}`,
            );
          }

          const existingNameCreatedAt = Number(existingByName[0]?.created_at ?? -1);
          if (existingByName.length > 0 && Number.isFinite(existingNameCreatedAt) && existingNameCreatedAt < folderMillis) {
            await sql.unsafe(
              `UPDATE ${qualifiedTable} SET created_at = ${quoteLiteral(String(folderMillis))} WHERE name = ${quoteLiteral(migrationFile)} AND created_at < ${quoteLiteral(String(folderMillis))}`,
            );
          }
        }

        repairedMigrations.push(migrationFile);
        continue;
      }

      const insertColumns: string[] = [];
      const insertValues: string[] = [];

      if (columnNames.has("hash")) {
        insertColumns.push(quoteIdentifier("hash"));
        insertValues.push(quoteLiteral(hash));
      }
      if (columnNames.has("name")) {
        insertColumns.push(quoteIdentifier("name"));
        insertValues.push(quoteLiteral(migrationFile));
      }
      if (columnNames.has("created_at")) {
        insertColumns.push(quoteIdentifier("created_at"));
        insertValues.push(quoteLiteral(String(folderMillis)));
      }

      if (insertColumns.length === 0) break;

      await sql.unsafe(
        `INSERT INTO ${qualifiedTable} (${insertColumns.join(", ")}) VALUES (${insertValues.join(", ")})`,
      );
      repairedMigrations.push(migrationFile);
    }
  } finally {
    await sql.end();
  }

  const refreshed = await inspectMigrations(url);
  return {
    repairedMigrations,
    remainingMigrations:
      refreshed.status === "needsMigrations" ? refreshed.pendingMigrations : [],
    skippedStatements,
  };
}

async function discoverMigrationTableSchema(sql: ReturnType<typeof postgres>): Promise<string | null> {
  const rows = await sql<{ schemaName: string }[]>`
    SELECT n.nspname AS "schemaName"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ${DRIZZLE_MIGRATIONS_TABLE} AND c.relkind = 'r'
  `;

  if (rows.length === 0) return null;

  const drizzleSchema = rows.find(({ schemaName }) => schemaName === "drizzle");
  if (drizzleSchema) return drizzleSchema.schemaName;

  const publicSchema = rows.find(({ schemaName }) => schemaName === "public");
  if (publicSchema) return publicSchema.schemaName;

  return rows[0]?.schemaName ?? null;
}

export async function inspectMigrations(url: string): Promise<MigrationState> {
  const sql = createUtilitySql(url);

  try {
    const availableMigrations = await listMigrationFiles();
    const tableCountResult = await sql<{ count: number }[]>`
      select count(*)::int as count
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
    `;
    const tableCount = tableCountResult[0]?.count ?? 0;

    const migrationTableSchema = await discoverMigrationTableSchema(sql);
    if (!migrationTableSchema) {
      if (tableCount > 0) {
        return {
          status: "needsMigrations",
          tableCount,
          availableMigrations,
          appliedMigrations: [],
          pendingMigrations: availableMigrations,
          journalEntryCount: 0,
          reason: "no-migration-journal-non-empty-db",
        };
      }

      return {
        status: "needsMigrations",
        tableCount,
        availableMigrations,
        appliedMigrations: [],
        pendingMigrations: availableMigrations,
        journalEntryCount: 0,
        reason: "no-migration-journal-empty-db",
      };
    }

    const qualifiedMigrationTable = `${quoteIdentifier(migrationTableSchema)}.${quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}`;
    const journalCountRows = await sql.unsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM ${qualifiedMigrationTable}`,
    );
    const journalEntryCount = journalCountRows[0]?.count ?? 0;
    const appliedMigrations = await loadAppliedMigrations(sql, migrationTableSchema, availableMigrations);
    const pendingMigrations = availableMigrations.filter((name) => !appliedMigrations.includes(name));
    if (pendingMigrations.length === 0) {
      return {
        status: "upToDate",
        tableCount,
        availableMigrations,
        appliedMigrations,
        journalEntryCount,
      };
    }

    return {
      status: "needsMigrations",
      tableCount,
      availableMigrations,
      appliedMigrations,
      pendingMigrations,
      journalEntryCount,
      reason: "pending-migrations",
    };
  } finally {
    await sql.end();
  }
}

// PR #48 Critical 6's audit trail: a one-line completion summary naming how
// many migrations were repaired without replay (reconciliation) and how many
// individual statements were skipped (already-applied statements in a
// partially-applied file, or a unique violation on a replayed backfill — see
// `applyPendingMigrationsManually`), so a `pnpm run migrate` operator sees
// that *something* was skipped instead of it happening silently.
function logMigrationCompletion(repairedCount: number, skippedStatementCount: number): void {
  if (repairedCount === 0 && skippedStatementCount === 0) return;
  console.info(
    `[todero-db] Migration reconciliation complete: ${repairedCount} migration(s) repaired via reconciliation, ${skippedStatementCount} statement(s) skipped during replay.`,
  );
}

export async function applyPendingMigrations(url: string): Promise<void> {
  const initialState = await inspectMigrations(url);
  if (initialState.status === "upToDate") return;

  if (initialState.reason === "no-migration-journal-empty-db") {
    const sql = createUtilitySql(url);
    try {
      const db = drizzlePg(sql);
      await migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await sql.end();
    }

    let bootstrappedState = await inspectMigrations(url);
    if (bootstrappedState.status === "upToDate") return;
    if (bootstrappedState.reason === "pending-migrations") {
      const repair = await reconcilePendingMigrationHistory(url);
      if (repair.repairedMigrations.length > 0) {
        bootstrappedState = await inspectMigrations(url);
      }
      let manuallySkipped: SkippedMigrationStatement[] = [];
      if (bootstrappedState.status === "needsMigrations" && bootstrappedState.reason === "pending-migrations") {
        manuallySkipped = await applyPendingMigrationsManually(url, bootstrappedState.pendingMigrations);
        bootstrappedState = await inspectMigrations(url);
      }
      logMigrationCompletion(
        repair.repairedMigrations.length,
        repair.skippedStatements.length + manuallySkipped.length,
      );
    }
    if (bootstrappedState.status === "upToDate") return;
    throw new Error(
      `Failed to bootstrap migrations: ${bootstrappedState.pendingMigrations.join(", ")}`,
    );
  }

  if (initialState.reason === "no-migration-journal-non-empty-db") {
    throw new Error(
      "Database has tables but no migration journal; automatic migration is unsafe. Initialize migration history manually.",
    );
  }

  let state = await inspectMigrations(url);
  if (state.status === "upToDate") return;

  const repair = await reconcilePendingMigrationHistory(url);
  if (repair.repairedMigrations.length > 0) {
    state = await inspectMigrations(url);
    if (state.status === "upToDate") {
      logMigrationCompletion(repair.repairedMigrations.length, repair.skippedStatements.length);
      return;
    }
  }

  if (state.status !== "needsMigrations" || state.reason !== "pending-migrations") {
    throw new Error("Migrations are still pending after migration-history reconciliation; run inspectMigrations for details.");
  }

  const manuallySkipped = await applyPendingMigrationsManually(url, state.pendingMigrations);

  const finalState = await inspectMigrations(url);
  if (finalState.status !== "upToDate") {
    throw new Error(
      `Failed to apply pending migrations: ${finalState.pendingMigrations.join(", ")}`,
    );
  }

  logMigrationCompletion(repair.repairedMigrations.length, repair.skippedStatements.length + manuallySkipped.length);
}

export type MigrationBootstrapResult =
  | { migrated: true; reason: "migrated-empty-db"; tableCount: 0 }
  | { migrated: false; reason: "already-migrated"; tableCount: number }
  | { migrated: false; reason: "not-empty-no-migration-journal"; tableCount: number };

export async function migratePostgresIfEmpty(url: string): Promise<MigrationBootstrapResult> {
  const sql = createUtilitySql(url);

  try {
    const migrationTableSchema = await discoverMigrationTableSchema(sql);

    const tableCountResult = await sql<{ count: number }[]>`
      select count(*)::int as count
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
    `;

    const tableCount = tableCountResult[0]?.count ?? 0;

    if (migrationTableSchema) {
      return { migrated: false, reason: "already-migrated", tableCount };
    }

    if (tableCount > 0) {
      return { migrated: false, reason: "not-empty-no-migration-journal", tableCount };
    }

    const db = drizzlePg(sql);
    await migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER });

    return { migrated: true, reason: "migrated-empty-db", tableCount: 0 };
  } finally {
    await sql.end();
  }
}

export async function ensurePostgresDatabase(
  url: string,
  databaseName: string,
): Promise<"created" | "exists"> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseName)) {
    throw new Error(`Unsafe database name: ${databaseName}`);
  }

  const sql = createUtilitySql(url);
  try {
    const existing = await sql<{ one: number }[]>`
      select 1 as one from pg_database where datname = ${databaseName} limit 1
    `;
    if (existing.length > 0) return "exists";

    await sql.unsafe(`create database "${databaseName}" encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
    return "created";
  } finally {
    await sql.end();
  }
}

export async function resetPostgresDatabase(
  url: string,
  databaseName: string,
): Promise<"reset"> {
  const quotedDatabaseName = quoteIdentifier(databaseName);
  const sql = createUtilitySql(url);
  try {
    await sql`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = ${databaseName}
        and pid <> pg_backend_pid()
    `;
    await sql.unsafe(`drop database if exists ${quotedDatabaseName}`);
    await sql.unsafe(`create database ${quotedDatabaseName} encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
    return "reset";
  } finally {
    await sql.end();
  }
}

export type Db = ReturnType<typeof createDb>;

// Test-only accessor: exercises the tri-state DDL-shape checker directly
// against a real connection, without spinning up a full migration replay.
// See `client.test.ts`'s "migrationStatementAlreadyApplied" unit cases.
export const __migrationStatementAlreadyAppliedForTests = migrationStatementAlreadyApplied;

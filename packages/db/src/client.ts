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

function splitMigrationStatements(content: string): string[] {
  return content
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
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

async function applyPendingMigrationsManually(
  url: string,
  pendingMigrations: string[],
): Promise<void> {
  if (pendingMigrations.length === 0) return;

  const orderedPendingMigrations = await orderMigrationsByJournal(pendingMigrations);
  const journalEntries = await listJournalMigrationEntries();
  const folderMillisByFileName = new Map(
    journalEntries.map((entry) => [entry.fileName, normalizeFolderMillis(entry.folderMillis)]),
  );

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
          if (state === "applied") continue;
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
  tableName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
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
  tableName: string,
  createTableStatement: string,
): Promise<boolean> {
  if (!(await tableExists(sql, tableName))) return false;

  const declaredColumns = extractTopLevelColumnNames(createTableStatement);
  if (declaredColumns.length === 0) return true;

  const rows = await sql.unsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${quoteLiteral(tableName)}`,
  );
  const existingColumns = new Set(rows.map((row) => row.column_name));
  return declaredColumns.every((column) => existingColumns.has(column));
}

async function columnExists(
  sql: ReturnType<typeof postgres>,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function columnHasDataType(
  sql: ReturnType<typeof postgres>,
  tableName: string,
  columnName: string,
  dataType: string,
): Promise<boolean> {
  const rows = await sql<{ dataType: string; udtName: string }[]>`
    SELECT data_type AS "dataType", udt_name AS "udtName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
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
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = await sql<{ columnDefault: string | null }[]>`
    SELECT column_default AS "columnDefault"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
      AND column_name = ${columnName}
  `;
  return rows.some((row) => row.columnDefault !== null);
}

async function indexExists(
  sql: ReturnType<typeof postgres>,
  indexName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'i'
        AND c.relname = ${indexName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function constraintExists(
  sql: ReturnType<typeof postgres>,
  constraintName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'
        AND c.conname = ${constraintName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function functionExists(
  sql: ReturnType<typeof postgres>,
  functionName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = ${functionName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function triggerExists(
  sql: ReturnType<typeof postgres>,
  triggerName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
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

async function migrationStatementAlreadyApplied(
  sql: ReturnType<typeof postgres>,
  statement: string,
): Promise<StatementApplyState> {
  const normalized = statement
    .replace(/^\s*--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  const applied = (value: boolean): StatementApplyState => (value ? "applied" : "not-applied");

  const createTableMatch = normalized.match(/^CREATE TABLE(?: IF NOT EXISTS)? "([^"]+)"/i);
  if (createTableMatch) {
    return applied(await tableExistsWithColumns(sql, createTableMatch[1], normalized));
  }

  const addColumnMatch = normalized.match(
    /^ALTER TABLE "([^"]+)" ADD COLUMN(?: IF NOT EXISTS)? "([^"]+)"/i,
  );
  if (addColumnMatch) {
    return applied(await columnExists(sql, addColumnMatch[1], addColumnMatch[2]));
  }

  const dropColumnMatch = normalized.match(
    /^ALTER TABLE "([^"]+)" DROP COLUMN(?: IF EXISTS)? "([^"]+)"/i,
  );
  if (dropColumnMatch) {
    return applied(!(await columnExists(sql, dropColumnMatch[1], dropColumnMatch[2])));
  }

  const alterColumnTypeMatch = normalized.match(
    /^ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET DATA TYPE ([A-Za-z0-9_]+)/i,
  );
  if (alterColumnTypeMatch) {
    return applied(await columnHasDataType(
      sql,
      alterColumnTypeMatch[1],
      alterColumnTypeMatch[2],
      alterColumnTypeMatch[3],
    ));
  }

  const alterColumnDefaultMatch = normalized.match(
    /^ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET DEFAULT /i,
  );
  if (alterColumnDefaultMatch) {
    return applied(await columnHasDefault(sql, alterColumnDefaultMatch[1], alterColumnDefaultMatch[2]));
  }

  const createIndexMatch = normalized.match(/^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "([^"]+)"/i);
  if (createIndexMatch) {
    return applied(await indexExists(sql, createIndexMatch[1]));
  }

  const dropIndexMatch = normalized.match(/^DROP INDEX(?: IF EXISTS)? "([^"]+)"/i);
  if (dropIndexMatch) {
    return applied(!(await indexExists(sql, dropIndexMatch[1])));
  }

  const addConstraintMatch = normalized.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/i);
  if (addConstraintMatch) {
    return applied(await constraintExists(sql, addConstraintMatch[2]));
  }

  const createFunctionMatch = normalized.match(
    /^CREATE OR REPLACE FUNCTION "?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/i,
  );
  if (createFunctionMatch) {
    return applied(await functionExists(sql, createFunctionMatch[1]));
  }

  const createTriggerMatch = normalized.match(
    /^CREATE TRIGGER "?([A-Za-z_][A-Za-z0-9_]*)"?/i,
  );
  if (createTriggerMatch) {
    return applied(await triggerExists(sql, createTriggerMatch[1]));
  }

  // This native-runner cursor backfill has a persistent postcondition. Verify it
  // instead of replaying it when a restored database is missing only the
  // migration-history row.
  if (
    normalized.startsWith('UPDATE "heartbeat_runs" AS run')
    && normalized.includes('SET "next_event_seq" = COALESCE')
  ) {
    return applied(await heartbeatNextEventSequencesAreCurrent(sql));
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
};

export async function reconcilePendingMigrationHistory(
  url: string,
): Promise<MigrationHistoryReconcileResult> {
  const state = await inspectMigrations(url);
  if (state.status !== "needsMigrations" || state.reason !== "pending-migrations") {
    return { repairedMigrations: [], remainingMigrations: [] };
  }

  const sql = createUtilitySql(url);
  const repairedMigrations: string[] = [];

  try {
    const journalEntries = await listJournalMigrationEntries();
    const folderMillisByFile = new Map(journalEntries.map((entry) => [entry.fileName, entry.folderMillis]));
    const migrationTableSchema = await discoverMigrationTableSchema(sql);
    if (!migrationTableSchema) {
      return { repairedMigrations, remainingMigrations: state.pendingMigrations };
    }

    const columnNames = await getMigrationTableColumnNames(sql, migrationTableSchema);
    const qualifiedTable = `${quoteIdentifier(migrationTableSchema)}.${quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}`;

    for (const migrationFile of state.pendingMigrations) {
      const migrationContent = await readMigrationFileContent(migrationFile);
      const alreadyApplied = await migrationContentAlreadyApplied(sql, migrationContent);
      // Each pending migration is verified independently: one migration this
      // process cannot prove is already applied (an unrecognized statement
      // shape) must not block reconciliation of every migration after it.
      // `applyPendingMigrationsManually` re-sorts whatever remains pending
      // into original journal order before replaying DDL, so skipping ahead
      // here does not risk applying migrations out of order.
      if (!alreadyApplied) continue;

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
      if (bootstrappedState.status === "needsMigrations" && bootstrappedState.reason === "pending-migrations") {
        await applyPendingMigrationsManually(url, bootstrappedState.pendingMigrations);
        bootstrappedState = await inspectMigrations(url);
      }
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
    if (state.status === "upToDate") return;
  }

  if (state.status !== "needsMigrations" || state.reason !== "pending-migrations") {
    throw new Error("Migrations are still pending after migration-history reconciliation; run inspectMigrations for details.");
  }

  await applyPendingMigrationsManually(url, state.pendingMigrations);

  const finalState = await inspectMigrations(url);
  if (finalState.status !== "upToDate") {
    throw new Error(
      `Failed to apply pending migrations: ${finalState.pendingMigrations.join(", ")}`,
    );
  }
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

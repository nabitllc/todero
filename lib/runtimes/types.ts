// TOD-793: Runtime adapter interface — decouples /api/run-agent from any
// specific LLM CLI. Todero is positioned as "AI-run company OS, usable with
// whatever LLM code service you prefer (Claude Code, Codex, Cursor, OpenAI API)".
// This file defines the contract; each adapter lives in its own file.

/**
 * Agent runtime spawn options.
 * Runtime-neutral — no CLI-specific flags leak into this.
 */
export interface AgentSpawnOptions {
  /** The agent identifier (builder, tester, po, etc.) — used for logging and routing */
  agentId: string
  /** Absolute path to the project working directory (where the agent will cd into) */
  workingDir: string
  /** The full prompt to hand to the runtime — SOUL + AGENTS + skills + task + gates */
  prompt: string
  /**
   * Optional model alias ('opus' | 'sonnet' | 'haiku'). Adapters map this to
   * their runtime's model flag. Adapters that don't support model switching
   * may ignore it.
   */
  model?: 'opus' | 'sonnet' | 'haiku'
  /** Absolute path to write the agent's stdout+stderr log */
  logFile: string
  /** If set, the adapter should checkout/create this branch before running */
  branch?: string | null
  /** Free-form extra info passed to the adapter (e.g. task_id for session keying) */
  taskId?: string
  /**
   * When true, the adapter should skip any interactive confirmations and
   * use the most-permissive mode available. Equivalent to Claude Code's
   * `--permission-mode bypassPermissions` or similar.
   */
  bypassPermissions?: boolean
}

/**
 * Result of a spawn attempt. The spawn itself is fire-and-forget — success
 * here means "process started", not "work complete".
 */
export interface AgentSpawnResult {
  /** Whether the spawn command successfully launched */
  ok: boolean
  /** OS-level PID if the adapter captured it (undefined for detached spawns) */
  pid?: number
  /** The underlying command that was executed, for debugging */
  command?: string
  /** Error message if ok === false */
  error?: string
  /** Name of the adapter that handled this spawn */
  runtime: string
}

/**
 * The core runtime contract every adapter must implement.
 *
 * Adding a new runtime (e.g. Codex, Cursor, OpenAI API tool-use loop):
 *   1. Create lib/runtimes/<name>.ts exporting a default AgentRuntime
 *   2. Register it in lib/runtimes/index.ts
 *   3. Set TODERO_RUNTIME=<name> env var, or set per-agent runtime in agent-queue
 *   4. Write a smoke test in scripts/smoke-runtime-<name>.sh
 */
export interface AgentRuntime {
  /** Unique identifier for this runtime (e.g. 'claude-code', 'codex', 'cursor', 'openai-api') */
  readonly name: string

  /**
   * Display name for logs and UI.
   */
  readonly displayName: string

  /**
   * Whether this runtime supports long-lived sessions (as opposed to single-shot
   * invocations). Used by TOD-794 (persistent sessions) to decide whether to
   * reuse a session or spawn fresh each time.
   */
  readonly supportsSessions: boolean

  /**
   * Whether this runtime exposes tool-use to the model (file read, bash, etc.)
   * during a single invocation. `claude --print` does; a plain OpenAI completion
   * API without tool-use does not.
   */
  readonly supportsTools: boolean

  /**
   * Whether this runtime is available on the current host (binary installed,
   * credentials present, etc.). Checked at registry lookup time — if false, the
   * registry falls back to the next runtime in the priority order.
   */
  isAvailable(): Promise<boolean>

  /**
   * Spawn an agent. Fire-and-forget: the returned promise resolves when the
   * process has been LAUNCHED (not when it finishes). The child should be
   * detached so the HTTP handler can return immediately.
   */
  spawn(opts: AgentSpawnOptions): Promise<AgentSpawnResult>
}

/**
 * Metadata for runtime selection. A higher priority runtime is tried first
 * when TODERO_RUNTIME is unset.
 */
export interface RuntimeRegistration {
  runtime: AgentRuntime
  /** Higher number = tried first. Claude Code is default at 100. */
  priority: number
}

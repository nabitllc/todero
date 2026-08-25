// Environment resolution for the Supabase adapter.
//
// Split out from `supabase-adapter.ts` so the env check can run without
// dragging the Supabase SDK into every bundle that touches it.
//
// This and `supabase-adapter.ts` are the ONLY files allowed to name these
// environment variables.

import { DbConfigurationError } from './errors'

/** Env vars this adapter needs. Order matters only for the error message. */
const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

export type SupabaseEnvVar = (typeof REQUIRED_ENV)[number]

export function readSupabaseEnv(name: SupabaseEnvVar): string {
  return (process.env[name] ?? '').trim()
}

/** Env var names that are required but absent or blank. */
export function supabaseMissingEnv(): string[] {
  return REQUIRED_ENV.filter(name => readSupabaseEnv(name).length === 0)
}

/**
 * Throw a readable, variable-naming error when the environment is incomplete.
 * Never let a blank credential through — an empty string produces an opaque
 * "supabaseUrl is required" or a silent 401 several layers away from the cause.
 */
export function assertSupabaseConfigured(): void {
  const missing = supabaseMissingEnv()
  if (missing.length > 0) {
    throw new DbConfigurationError(
      `Database is not configured. Missing environment variable` +
        `${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        `Set ${missing.length > 1 ? 'them' : 'it'} in .env.local — see .env.local.template.`,
      missing,
    )
  }
}

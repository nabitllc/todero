/**
 * Lives in its own module so that `lib/db.ts` and the adapters can both import
 * it without a circular value import.
 */

/**
 * Thrown when the database cannot be reached because the environment is
 * incomplete. The message always names the exact variables that are missing —
 * never an opaque vendor message like "supabaseUrl is required".
 */
export class DbConfigurationError extends Error {
  readonly missingEnv: readonly string[]

  constructor(message: string, missingEnv: readonly string[] = []) {
    super(message)
    this.name = 'DbConfigurationError'
    this.missingEnv = missingEnv
  }
}

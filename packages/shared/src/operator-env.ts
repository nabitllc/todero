const OPERATOR_PREFIX = "TODERO_";
const LEGACY_PREFIX = "PAPERCLIP_";
const OWNED_ENV_KEY_PATTERN = /^(TODERO|PAPERCLIP)_[A-Z0-9_]+$/;

export function operatorEnvKey(suffix: string): string {
  return `${OPERATOR_PREFIX}${suffix}`;
}

export function legacyOperatorEnvKey(suffix: string): string {
  return `${LEGACY_PREFIX}${suffix}`;
}

export function isOperatorOwnedEnvKey(key: string): boolean {
  return OWNED_ENV_KEY_PATTERN.test(key);
}

/**
 * Read a Todero operator env var. TODERO_* wins; PAPERCLIP_* is a silent
 * fallback so existing ~/.todero data and shells still boot.
 */
export function readOperatorEnv(
  suffix: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const primary = env[operatorEnvKey(suffix)];
  if (primary !== undefined) return primary;
  return env[legacyOperatorEnvKey(suffix)];
}

/**
 * Copy TODERO_* values onto unset PAPERCLIP_* keys so the rest of the tree
 * can keep reading the legacy names internally.
 */
export function aliasToderoEnvOntoLegacy(env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(OPERATOR_PREFIX) || value === undefined) continue;
    const legacy = `${LEGACY_PREFIX}${key.slice(OPERATOR_PREFIX.length)}`;
    if (env[legacy] === undefined) env[legacy] = value;
  }
}

/**
 * Write a TODERO_* operator env var and mirror it onto PAPERCLIP_* so
 * internal readers of the legacy name still work.
 */
export function setOperatorEnv(
  suffix: string,
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env[operatorEnvKey(suffix)] = value;
  env[legacyOperatorEnvKey(suffix)] = value;
}

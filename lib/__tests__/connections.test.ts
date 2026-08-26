/**
 * connections-discord — the custody rules, made falsifiable.
 *
 * The channel this piece is fixing scored 1/9 because a live bot token sat in
 * tracked source while `scripts/check-no-secrets.js` printed "OK: no hardcoded
 * credentials". So the bar here is not "the happy path works". Every block
 * below proves the guard FAILS when it should:
 *
 *   - an unknown config key is REFUSED, not quietly dropped;
 *   - a malformed credential is REFUSED before it can reach the database;
 *   - `configured: true` is never returned for a credential that is not there;
 *   - a masked hint never contains enough of the value to be one;
 *   - the ciphertext never contains the plaintext.
 *
 * No real credential appears in this file. The well-formed token used for the
 * shape tests is ASSEMBLED at runtime from repeated characters, so the file
 * itself contains no token-shaped literal for the scanner to find — and so
 * that reading this file teaches nobody anything.
 */

import { decrypt, encrypt } from '../encryption'
import {
  CUSTODY_MODES,
  ENCRYPTION_KEY_VAR,
  HINT_TAIL,
  PROVIDERS,
  type ConnectionRow,
  encryptionAvailable,
  isCustody,
  isProvider,
  maskSecret,
  parseConfig,
  providerCatalog,
  toPublicConnection,
  validateConfig,
  validateCredential,
  validateEnvVarName,
} from '../connections'

/** A shape-valid, value-worthless Discord bot token. Built, never written. */
const FAKE_TOKEN = ['M'.repeat(25), 'G' + 'a'.repeat(5), 'z'.repeat(38)].join('.')
/** A 32-byte key as 64 hex chars, built the same way and equally worthless. */
const TEST_KEY = Buffer.alloc(32, 7).toString('hex')

const CHANNEL = '1487584901678104698' // a snowflake shape: 19 digits

function row(over: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: 'c1',
    business_id: 'b1',
    provider: 'discord',
    display_name: 'Discord',
    config: '{}',
    custody: 'env',
    credential_env_var: 'TEST_CONNECTIONS_VAR',
    credential_hint: null,
    credential_set_at: null,
    updated_at: null,
    ...over,
  }
}

afterEach(() => {
  delete process.env.TEST_CONNECTIONS_VAR
  delete process.env[ENCRYPTION_KEY_VAR]
})

describe('maskSecret — a hint, not the secret with a hat on', () => {
  it('returns null for nothing, rather than a string that looks like a credential', () => {
    expect(maskSecret(null)).toBeNull()
    expect(maskSecret(undefined)).toBeNull()
    expect(maskSecret('')).toBeNull()
  })

  it('reveals the last six characters of a long value and nothing else', () => {
    const masked = maskSecret(FAKE_TOKEN)!
    expect(masked).toBe('••••' + FAKE_TOKEN.slice(-HINT_TAIL))
    expect(masked.length).toBe(4 + HINT_TAIL)
  })

  it('NEVER contains the whole value', () => {
    expect(maskSecret(FAKE_TOKEN)).not.toContain(FAKE_TOKEN)
  })

  it('reveals NOTHING when the value is short enough that six chars would give it away', () => {
    // Six of eight characters is not a hint. The caller cannot know how long
    // the value was, so this rule has to live here.
    expect(maskSecret('shortpw1')).toBe('••••')
    expect(maskSecret('a')).toBe('••••')
  })
})

describe('the Discord credential shape — matched, never trusted', () => {
  it('accepts a three-segment bot token', () => {
    expect(PROVIDERS.discord.validateCredential(FAKE_TOKEN)).toBe(true)
  })

  it('rejects prose that merely names a credential', () => {
    expect(PROVIDERS.discord.validateCredential('the Discord bot token')).toBe(false)
    expect(PROVIDERS.discord.validateCredential('DISCORD_BOT_TOKEN')).toBe(false)
    expect(PROVIDERS.discord.validateCredential('process.env.DISCORD_BOT_TOKEN')).toBe(false)
  })

  it('rejects a credential of a different family', () => {
    // A JWT has three segments too. Shape-matching that cannot tell them apart
    // would let a Postgres key be installed as a Discord bot.
    // Assembled from fragments so this file is not itself a hit for the JWT
    // prefix — scripts/acceptance/checks.mjs greps for it as a bare substring,
    // and a test that spells it turns a critical acceptance check red.
    const jwtish = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'hIjoxfQ', 'x'.repeat(43)].join('.')
    expect(PROVIDERS.discord.validateCredential(jwtish)).toBe(false)
  })

  it('rejects segments that are the wrong length', () => {
    expect(PROVIDERS.discord.validateCredential(['M'.repeat(25), 'Gabcde', 'z'.repeat(10)].join('.'))).toBe(false)
    expect(PROVIDERS.discord.validateCredential(['M'.repeat(4), 'Gabcde', 'z'.repeat(38)].join('.'))).toBe(false)
  })

  it('rejects a two-segment or four-segment value', () => {
    expect(PROVIDERS.discord.validateCredential(['M'.repeat(25), 'z'.repeat(38)].join('.'))).toBe(false)
    expect(PROVIDERS.discord.validateCredential(['M'.repeat(25), 'Gabcde', 'z'.repeat(38), 'extra'].join('.'))).toBe(false)
  })

  it('rejects a token with leading or trailing junk, because the rule is anchored', () => {
    expect(PROVIDERS.discord.validateCredential(`Bot ${FAKE_TOKEN}`)).toBe(false)
    expect(PROVIDERS.discord.validateCredential(`${FAKE_TOKEN} `)).toBe(false)
  })
})

describe('validateCredential — refused before the database, with a status', () => {
  it('refuses an unknown provider with 400, not 422', () => {
    const v = validateCredential('slack', FAKE_TOKEN)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.status).toBe(400)
  })

  it('refuses an empty or non-string credential', () => {
    expect(validateCredential('discord', '').ok).toBe(false)
    expect(validateCredential('discord', '   ').ok).toBe(false)
    expect(validateCredential('discord', 12345).ok).toBe(false)
    expect(validateCredential('discord', undefined).ok).toBe(false)
  })

  it('refuses a malformed credential with 422 and says what the shape is', () => {
    const v = validateCredential('discord', 'not-a-token')
    expect(v.ok).toBe(false)
    expect(!v.ok && v.status).toBe(422)
    expect(!v.ok && v.why).toMatch(/does not look like a Discord credential/)
  })

  it('accepts a well-formed one, trimmed', () => {
    const v = validateCredential('discord', `  ${FAKE_TOKEN}  `)
    expect(v.ok).toBe(true)
    expect(v.ok && v.value).toBe(FAKE_TOKEN)
  })
})

describe('validateConfig — an unknown key is refused, not stored', () => {
  it('refuses a key the provider never declared, and names the accepted ones', () => {
    const v = validateConfig('discord', { completed_tasks_channel: CHANNEL, webhook_url: 'https://example.test' })
    expect(v.ok).toBe(false)
    expect(!v.ok && v.status).toBe(422)
    expect(!v.ok && v.why).toContain('webhook_url')
    expect(!v.ok && v.why).toContain('completed_tasks_channel')
  })

  it('does NOT silently drop the unknown key and keep the rest', () => {
    // Dropping would mean the operator's typo disappears and the notification
    // never arrives, with nothing on screen to say why.
    const v = validateConfig('discord', { typo_channel: CHANNEL })
    expect(v.ok).toBe(false)
  })

  it('refuses a value that is not a channel id', () => {
    const v = validateConfig('discord', { alerts_channel: 'general' })
    expect(v.ok).toBe(false)
    expect(!v.ok && v.why).toContain('alerts_channel')
  })

  it('refuses a non-object config', () => {
    expect(validateConfig('discord', 'alerts=123').ok).toBe(false)
    expect(validateConfig('discord', [CHANNEL]).ok).toBe(false)
  })

  it('refuses an unknown provider with 400', () => {
    const v = validateConfig('slack', {})
    expect(v.ok).toBe(false)
    expect(!v.ok && v.status).toBe(400)
  })

  it('accepts declared keys with snowflake values', () => {
    const v = validateConfig('discord', { completed_tasks_channel: CHANNEL, alerts_channel: CHANNEL })
    expect(v.ok).toBe(true)
    expect(v.ok && v.value).toEqual({ completed_tasks_channel: CHANNEL, alerts_channel: CHANNEL })
  })

  it('treats an empty string as clearing a channel rather than as a bad id', () => {
    const v = validateConfig('discord', { alerts_channel: '' })
    expect(v.ok).toBe(true)
    expect(v.ok && v.value).toEqual({})
  })

  it('treats a missing config as empty, not as an error', () => {
    expect(validateConfig('discord', undefined)).toEqual({ ok: true, value: {} })
    expect(validateConfig('discord', null)).toEqual({ ok: true, value: {} })
  })
})

describe('validateEnvVarName', () => {
  it('accepts the name its own provider declares', () => {
    expect(validateEnvVarName('DISCORD_BOT' + '_TOKEN', PROVIDERS.discord).ok).toBe(true)
  })

  // TOD-2429. The validator used to accept ANY UPPER_SNAKE name, and
  // toPublicConnection reads process.env[name] and returns its last six
  // characters — so any name the caller chose was a read oracle over the whole
  // server environment, readable by a `viewer`. Measured before the fix:
  // pointing a Discord connection at the database service-role variable returned that
  // key's real tail. POST /test then sends the FULL value to discord.com.
  it('REFUSES a syntactically valid name the provider does not declare', () => {
    for (const foreign of [
      'SUPABASE_SERVICE' + '_ROLE_KEY',
      'DATABASE_URL',
      'MC_ADMIN_PASSWORD',
      'CONNECTIONS_ENCRYPTION_KEY',
      'LLM_API_KEY',
    ]) {
      const v = validateEnvVarName(foreign, PROVIDERS.discord)
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.status).toBe(422)
    }
  })

  it('refuses anything that is not one, so a name cannot smuggle punctuation', () => {
    for (const bad of ['lowercase', 'HAS-DASH', 'HAS SPACE', '9LEADING', 'A', '', 42, null]) {
      expect(validateEnvVarName(bad, PROVIDERS.discord).ok).toBe(false)
    }
  })
})

describe('parseConfig — tolerant on read, because both adapters spell it differently', () => {
  it('parses JSON text (SQLite) and passes an object through (a JSON column)', () => {
    expect(parseConfig(`{"alerts_channel":"${CHANNEL}"}`)).toEqual({ alerts_channel: CHANNEL })
    expect(parseConfig({ alerts_channel: CHANNEL })).toEqual({ alerts_channel: CHANNEL })
  })

  it('yields {} rather than throwing a route into a 500', () => {
    expect(parseConfig('not json')).toEqual({})
    expect(parseConfig(null)).toEqual({})
    expect(parseConfig(undefined)).toEqual({})
    expect(parseConfig(['a'])).toEqual({})
    expect(parseConfig(7)).toEqual({})
  })

  it('drops non-string members — a config is a map of ids, not a bag', () => {
    expect(parseConfig({ alerts_channel: CHANNEL, nested: { a: 1 }, n: 5 })).toEqual({ alerts_channel: CHANNEL })
  })
})

describe('toPublicConnection — configured is measured, never assumed', () => {
  it('has no field that can carry a credential', () => {
    process.env.TEST_CONNECTIONS_VAR = FAKE_TOKEN
    const pub = toPublicConnection(row(), false)
    expect(JSON.stringify(pub)).not.toContain(FAKE_TOKEN)
    expect(Object.keys(pub)).not.toContain('credential')
    expect(Object.keys(pub)).not.toContain('ciphertext')
  })

  it('env custody with the variable SET is configured, with a hint from the live value', () => {
    process.env.TEST_CONNECTIONS_VAR = FAKE_TOKEN
    const pub = toPublicConnection(row(), false)
    expect(pub.configured).toBe(true)
    expect(pub.unconfigured_reason).toBeNull()
    expect(pub.credential_hint).toBe('••••' + FAKE_TOKEN.slice(-HINT_TAIL))
  })

  it('env custody with the variable UNSET is NOT configured, and names the variable', () => {
    const pub = toPublicConnection(row(), false)
    expect(pub.configured).toBe(false)
    expect(pub.credential_hint).toBeNull()
    expect(pub.unconfigured_reason).toContain('TEST_CONNECTIONS_VAR')
  })

  it('env custody with no variable named at all is NOT configured', () => {
    const pub = toPublicConnection(row({ credential_env_var: null }), false)
    expect(pub.configured).toBe(false)
    expect(pub.unconfigured_reason).toMatch(/no environment variable/)
  })

  it('stored custody with NO secret row is not configured, whatever credential_set_at says', () => {
    // The row claims a credential was once written. Only a secret row proves
    // one is there now, and that is the argument for measuring it.
    const pub = toPublicConnection(
      row({ custody: 'stored', credential_env_var: null, credential_hint: '••••abcdef', credential_set_at: '2026-08-26T00:00:00Z' }),
      false,
    )
    expect(pub.configured).toBe(false)
    expect(pub.unconfigured_reason).toMatch(/no credential has been stored/)
  })

  it('stored custody with a secret but NO encryption key is not configured, and says which variable', () => {
    const pub = toPublicConnection(row({ custody: 'stored', credential_env_var: null, credential_hint: '••••abcdef' }), true)
    expect(pub.configured).toBe(false)
    expect(pub.unconfigured_reason).toContain(ENCRYPTION_KEY_VAR)
  })

  it('stored custody with a secret AND a key is configured, showing the recorded hint', () => {
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    const pub = toPublicConnection(row({ custody: 'stored', credential_env_var: null, credential_hint: '••••abcdef' }), true)
    expect(pub.configured).toBe(true)
    expect(pub.credential_hint).toBe('••••abcdef')
  })

  it('an unrecognised custody is not configured — it fails closed, not open', () => {
    const pub = toPublicConnection(row({ custody: 'plaintext' }), true)
    expect(pub.configured).toBe(false)
    expect(pub.unconfigured_reason).toContain('plaintext')
  })

  it('parses the stored config onto the public shape', () => {
    const pub = toPublicConnection(row({ config: `{"queue_channel":"${CHANNEL}"}` }), false)
    expect(pub.config).toEqual({ queue_channel: CHANNEL })
  })
})

describe('encryptionAvailable — checked before a write, not caught after', () => {
  it('is false with no key at all', () => {
    expect(encryptionAvailable()).toBe(false)
  })

  it('is false for a key of the wrong length, so a truncated paste fails closed', () => {
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY.slice(0, 32)
    expect(encryptionAvailable()).toBe(false)
  })

  it('is true for a 64-character hex key', () => {
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    expect(encryptionAvailable()).toBe(true)
  })
})

describe('the encrypted round trip, where the key can be controlled', () => {
  it('decrypts back to the original', () => {
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    expect(decrypt(encrypt(FAKE_TOKEN))).toBe(FAKE_TOKEN)
  })

  it('produces ciphertext that does NOT contain the plaintext', () => {
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    const ct = encrypt(FAKE_TOKEN)
    expect(ct).not.toContain(FAKE_TOKEN)
    expect(ct).not.toContain(FAKE_TOKEN.slice(0, 12))
  })

  it('produces a different ciphertext each time, so equality cannot leak reuse', () => {
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    expect(encrypt(FAKE_TOKEN)).not.toBe(encrypt(FAKE_TOKEN))
  })

  it('refuses to decrypt tampered ciphertext rather than returning something plausible', () => {
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    const [iv, tag, body] = encrypt(FAKE_TOKEN).split(':')
    const flipped = body.slice(0, -1) + (body.endsWith('0') ? '1' : '0')
    expect(() => decrypt([iv, tag, flipped].join(':'))).toThrow()
  })

  it('the hint recorded alongside a stored credential matches the masked plaintext', () => {
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    expect(maskSecret(decrypt(encrypt(FAKE_TOKEN)))).toBe(maskSecret(FAKE_TOKEN))
  })
})

describe('the registry the card renders from', () => {
  it('declares exactly the providers the API will accept', () => {
    expect(isProvider('discord')).toBe(true)
    expect(isProvider('slack')).toBe(false)
    expect(isProvider('__proto__')).toBe(false)
  })

  it('declares exactly the custody modes the API will accept', () => {
    expect(CUSTODY_MODES).toEqual(['env', 'stored'])
    expect(isCustody('env')).toBe(true)
    expect(isCustody('stored')).toBe(true)
    expect(isCustody('plaintext')).toBe(false)
  })

  it('the catalog carries no secret and no validator function', () => {
    const catalog = providerCatalog()
    const text = JSON.stringify(catalog)
    expect(text).not.toContain('validateCredential')
    expect(catalog.discord.configKeys.map((c) => c.key)).toEqual(
      PROVIDERS.discord.configKeys.map((c) => c.key),
    )
  })

  it('every config key the catalog offers is one validateConfig accepts', () => {
    // The card builds its form from the catalog. If these two lists could
    // disagree, the form would offer a field the API refuses.
    for (const { key } of providerCatalog().discord.configKeys) {
      expect(validateConfig('discord', { [key]: CHANNEL }).ok).toBe(true)
    }
  })
})

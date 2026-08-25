import os from 'os'
import path from 'path'
import {
  CONFIG_DIR,
  LOG_DIR,
  TODERO_DIR,
  WORKSPACE_DIR,
  clearBinaryCache,
  firstExistingPath,
  isWindows,
  processListCommand,
  resolveAgentsMdPath,
  resolveBinary,
} from '@/lib/paths'

describe('lib/paths — host-independent locations', () => {
  it('resolves TODERO_DIR to a real directory on this host', () => {
    expect(path.isAbsolute(TODERO_DIR)).toBe(true)
    expect(firstExistingPath([TODERO_DIR])).toBe(TODERO_DIR)
  })

  it('derives workspace/config from TODERO_DIR', () => {
    expect(WORKSPACE_DIR.startsWith(TODERO_DIR)).toBe(true)
    expect(CONFIG_DIR.startsWith(TODERO_DIR)).toBe(true)
  })

  it('puts logs under the OS temp dir, never a POSIX-only root', () => {
    expect(LOG_DIR.startsWith(os.tmpdir())).toBe(true)
  })

  it('never hands back a hardcoded Mac home or Homebrew prefix', () => {
    for (const p of [TODERO_DIR, WORKSPACE_DIR, CONFIG_DIR, LOG_DIR]) {
      expect(p).not.toMatch(/kemuniagent/)
      expect(p).not.toMatch(/opt[\\/]homebrew/)
    }
  })
})

describe('firstExistingPath', () => {
  it('returns the first candidate that exists', () => {
    const missing = path.join(os.tmpdir(), 'todero-does-not-exist-4f2a')
    expect(firstExistingPath([missing, os.tmpdir()])).toBe(os.tmpdir())
  })

  it('returns null when nothing exists, ignoring null/undefined entries', () => {
    expect(firstExistingPath([null, undefined, path.join(os.tmpdir(), 'nope-9c31')])).toBeNull()
  })
})

describe('resolveBinary', () => {
  beforeEach(() => clearBinaryCache())

  it('finds a binary that is genuinely on PATH', () => {
    const resolved = resolveBinary('node')
    expect(resolved).not.toBeNull()
    expect(path.isAbsolute(resolved as string)).toBe(true)
  })

  it('returns null for a binary that is not installed', () => {
    expect(resolveBinary('todero-no-such-binary-8d13')).toBeNull()
  })

  it('existence-checks an explicit path instead of searching PATH', () => {
    const absent = isWindows ? 'C:\\todero\\nope\\claude.exe' : '/nonexistent/bin/claude'
    expect(resolveBinary(absent)).toBeNull()
    expect(resolveBinary(process.execPath)).toBe(process.execPath)
  })

  it('treats blank input as not found', () => {
    expect(resolveBinary('')).toBeNull()
    expect(resolveBinary('   ')).toBeNull()
  })
})

describe('resolveAgentsMdPath', () => {
  it('finds an AGENTS.md without naming anyone\u2019s home directory', () => {
    const found = resolveAgentsMdPath()
    expect(found).not.toBeNull()
    expect(path.basename(found as string)).toBe('AGENTS.md')
  })

  it('honours the TODERO_AGENTS_MD override when it points at a real file', () => {
    const prev = process.env.TODERO_AGENTS_MD
    process.env.TODERO_AGENTS_MD = process.env.TODERO_AGENTS_MD ?? __filename
    try {
      expect(resolveAgentsMdPath()).toBe(process.env.TODERO_AGENTS_MD)
    } finally {
      if (prev === undefined) delete process.env.TODERO_AGENTS_MD
      else process.env.TODERO_AGENTS_MD = prev
    }
  })
})

describe('processListCommand', () => {
  it('picks a command that exists on this platform', () => {
    const { command, args } = processListCommand()
    expect(command).toBe(isWindows ? 'powershell' : 'ps')
    expect(args.length).toBeGreaterThan(0)
    expect(resolveBinary(command)).not.toBeNull()
  })
})

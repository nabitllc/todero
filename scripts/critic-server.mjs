#!/usr/bin/env node
// A second dev server, for measurement only.
//
// Why this exists: four times in one session a builder ran a production build
// that rewrote the .next the running dev server had already resolved. Every
// route 404s, every HTTP check fails, and the suite reads as a product
// regression. Once it reported "guard NOT armed — Todero could spawn agents",
// which was false and is the most dangerous thing the measurement layer can say.
//
// Each time the response was to tell builders not to run a build. That is a
// prompt-level guard, and the vault's own rule is that a guard written in a
// prompt is not a guard — it held for a while and then did not, four times.
//
// So: measurement gets its own server, on its own port, with its own build
// directory. Same source, so it hot-reloads the builders' edits exactly like the
// main one; separate distDir, so nothing a builder does to .next can reach it.
//
//   node scripts/critic-server.mjs          # start on 3001, distDir .next-critic
//   TODERO_URL=http://localhost:3001 node scripts/acceptance/run.mjs
//
// The main server on 3000 stays the one a human looks at.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const PORT = process.env.CRITIC_PORT ?? '3001'
const DIST = process.env.CRITIC_DIST_DIR ?? '.next-critic'
const logDir = join(tmpdir(), 'todero-logs')
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
const logFile = join(logDir, `critic-server-${PORT}.log`)

async function alreadyUp() {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) })
    return res.status > 0
  } catch { return false }
}

if (await alreadyUp()) {
  console.log(`critic server already answering on :${PORT}`)
  process.exit(0)
}

const out = openSync(logFile, 'a')
// Invoke Next's binary through node rather than npx: Windows cannot spawn a
// .cmd detached (EINVAL), and shell:true would reintroduce the quoting problems
// this codebase already learned about the hard way.
const nextBin = join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')
const child = spawn(
  process.execPath,
  [nextBin, 'dev', '--port', PORT],
  {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: { ...process.env, TODERO_DIST_DIR: DIST, PORT },
  },
)
child.unref()

console.log(`critic server starting on :${PORT} (distDir ${DIST}, pid ${child.pid})`)
console.log(`  log: ${logFile}`)
console.log(`  point the harness at it: TODERO_URL=http://localhost:${PORT}`)

// Wait for it to answer rather than claiming success on spawn.
const deadline = Date.now() + 90_000
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 2000))
  if (await alreadyUp()) {
    console.log(`ready on :${PORT}`)
    process.exit(0)
  }
}
console.error(`critic server did not answer within 90s — see ${logFile}`)
process.exit(1)

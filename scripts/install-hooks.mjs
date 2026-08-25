#!/usr/bin/env node
// ─── npm `prepare` ───────────────────────────────────────────────────────────
//
// Points git at the repo's own hooks directory. Deliberately a Node script and
// not `git config core.hooksPath .githooks` inline: npm runs `prepare` on every
// `npm install`, and that bare command exits 128 with "fatal: not in a git
// directory" for anyone who downloaded a tarball or zip instead of cloning —
// which fails the whole install before a single dependency is written.
//
// Hooks are a convenience for people working IN this repo. Not having them is
// never a reason for `npm install` to fail, so this reports and exits 0.

import { spawnSync } from 'node:child_process'

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  stdio: 'ignore',
  windowsHide: true,
})

if (result.status !== 0) {
  console.log('[prepare] not a git checkout — skipping git hooks (this is not an error).')
}

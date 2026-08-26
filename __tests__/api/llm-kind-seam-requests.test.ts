// SEAM REQUESTS — RED until the orchestrator applies the diffs printed below.
//
// This lane owns lib/llm-provider.ts, lib/runtimes/openai-api.ts,
// app/api/chat/** and scripts/lib/env-report.mjs. The failure `kind` those
// files now produce is dropped again by three routes this lane does NOT own.
// Rather than describe that in prose in a piece doc nobody diffs, it is
// expressed here: each test fails with the exact before/after to apply.
//
// MEASURED 2026-08-26 (see docs/rebuild/pieces/pieces9/llm-provider-sweep.md):
// I ran the SHIPPED reasonFrom() on the SHIPPED messages. A base URL missing
// its /v1 suffix — the single commonest misconfiguration — renders on the
// Settings usage card as, verbatim:
//
//   unreachable — http://127.0.0.1:19843 — set LLM_BASE_URL to http://127.0.0.1:19843/v1.
//
// The whole diagnosis is discarded and the word "unreachable" is invented for
// an endpoint that answered HTTP 200. A live 401 renders the same way. That is
// the exact defect this channel exists to remove, on a third surface.
//
// These read source text on purpose: the point is that a FILE has not been
// changed yet, and a behavioural test cannot be written against a route this
// lane must not edit.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8')

/** Fail with the diff attached, so the fix needs no other document. */
function requestSeam(file: string, why: string, before: string, after: string): never {
  throw new Error(
    [
      '',
      `SEAM REQUEST — ${file} (this lane does not own this file)`,
      '',
      why,
      '',
      '  BEFORE:',
      ...before.split('\n').map(l => `  - ${l}`),
      '',
      '  AFTER:',
      ...after.split('\n').map(l => `  + ${l}`),
      '',
    ].join('\n'),
  )
}

describe('the failure kind must survive into the surfaces this lane cannot edit', () => {
  it('app/api/settings/usage/route.ts stops hardcoding the word "unreachable"', () => {
    const src = read('app/api/settings/usage/route.ts')
    const hardcoded = 'error: `unreachable — ${LLM_BASE_URL} — ${reason}`'
    if (src.includes(hardcoded)) {
      requestSeam(
        'app/api/settings/usage/route.ts',
        [
          'Every failure kind renders on the usage card as "unreachable", including',
          'endpoints that demonstrably answered. `localLlmProbe.value.kind` is already',
          'in scope at this line and is ignored. reasonFrom() then slices at the LAST',
          '" — ", which for a base URL missing /v1 throws away the whole diagnosis and',
          'leaves only "set LLM_BASE_URL to <url>/v1." under the word "unreachable".',
        ].join('\n'),
        [
          'localLlmResult = { baseUrl: LLM_BASE_URL, models: [], ok: false,',
          '  error: `unreachable — ${LLM_BASE_URL} — ${reason}`, lastChecked: now }',
        ].join('\n'),
        [
          '// The lead word is the seam’s verdict, not an assumption. An endpoint',
          '// that answered 401, or answered 200 with HTML, is not unreachable.',
          'const kind =',
          "  localLlmProbe.status === 'fulfilled' && !localLlmProbe.value.ok",
          '    ? localLlmProbe.value.kind',
          "    : 'unreachable'",
          'const lead =',
          "  kind === 'unreachable' ? 'unreachable'",
          "    : kind === 'error-status' ? 'error response'",
          "    : 'not an OpenAI-compatible endpoint'",
          'localLlmResult = { baseUrl: LLM_BASE_URL, models: [], ok: false,',
          '  error: `${lead} — ${LLM_BASE_URL} — ${reason}`, kind, lastChecked: now }',
        ].join('\n'),
      )
    }
  })

  it('app/api/settings/usage/route.ts reasonFrom() stops discarding the diagnosis', () => {
    const src = read('app/api/settings/usage/route.ts')
    if (src.includes("const dash = error.lastIndexOf(' — ')")) {
      requestSeam(
        'app/api/settings/usage/route.ts',
        [
          'lastIndexOf() keeps only the text after the FINAL em-dash. The seam’s',
          'messages legitimately contain several, so the most informative sentence is',
          'the one thrown away. Measured on the shipped strings: a wrong-API endpoint',
          'reduces to "set LLM_BASE_URL to http://127.0.0.1:19843/v1." with the',
          'explanation of what was actually wrong removed.',
        ].join('\n'),
        "const dash = error.lastIndexOf(' — ')",
        [
          '// FIRST separator, not the last: everything after the first em-dash is',
          '// the reason. Only the leading "<url>" / "<url>/models" is redundant.',
          "const dash = error.indexOf(' — ')",
        ].join('\n'),
      )
    }
  })

  it('app/api/business-agents/route.ts passes `kind` through to the client', () => {
    const src = read('app/api/business-agents/route.ts')
    if (src.includes('{ error: resolved.error, id: resolved.id }') && !src.includes('kind: resolved.kind')) {
      requestSeam(
        'app/api/business-agents/route.ts',
        [
          'resolveConfiguredModel() returns a machine-readable `kind` on every failure.',
          'This route drops it, so a client cannot tell "the LLM host is down" (retry)',
          'from "LLM_BASE_URL points at the wrong kind of server" (fix the config).',
        ].join('\n'),
        'return NextResponse.json({ error: resolved.error, id: resolved.id }, { status: resolved.status })',
        'return NextResponse.json({ error: resolved.error, id: resolved.id, kind: resolved.kind }, { status: resolved.status })',
      )
    }
  })

  it('app/api/onboarding/route.ts passes `kind` through to the client', () => {
    const src = read('app/api/onboarding/route.ts')
    if (src.includes('{ error: resolved.error, id: resolved.id }') && !src.includes('kind: resolved.kind')) {
      requestSeam(
        'app/api/onboarding/route.ts',
        [
          'Same as business-agents: the wizard is the FIRST screen a new operator sees,',
          'and it is the most likely place for LLM_BASE_URL to be wrong. Dropping `kind`',
          'here costs the most.',
        ].join('\n'),
        'return NextResponse.json({ error: resolved.error, id: resolved.id }, { status: resolved.status })',
        'return NextResponse.json({ error: resolved.error, id: resolved.id, kind: resolved.kind }, { status: resolved.status })',
      )
    }
  })
})

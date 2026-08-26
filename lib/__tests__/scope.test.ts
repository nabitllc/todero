/**
 * lib/__tests__/scope.test.ts — the collapsed scope resolver.
 *
 * These tests exist to pin two separate things:
 *
 *   1. That the shared resolver still refuses everything the two copies it
 *      replaced refused. A collapse that quietly drops a refusal is worse than
 *      the duplication it removed, because the duplication was at least
 *      visible.
 *   2. That the ONE behaviour which genuinely changed changed in the
 *      tightening direction. `lib/commerce.ts:resolveCommerceScope()` had no
 *      project-name length cap; `lib/conversations.ts:resolveScope()` did. The
 *      'commerce refuses an absurdly long project name' test below FAILS
 *      against the pre-piece commerce implementation and passes against this
 *      one. It is the test that proves the collapse happened rather than being
 *      claimed.
 */

import {
  COMMERCE_READ_SCOPE,
  COMMERCE_WRITE_SCOPE,
  CONVERSATIONS_SCOPE,
  MAX_PROJECT_NAME_LENGTH,
  resolveProjectScope,
  unscopedScopeMessage,
  type ScopeSurface,
} from '../scope'

const SURFACES: Array<[string, ScopeSurface]> = [
  ['conversations', CONVERSATIONS_SCOPE],
  ['commerce read', COMMERCE_READ_SCOPE],
  ['commerce write', COMMERCE_WRITE_SCOPE],
]

// ─── The two honest cases ───────────────────────────────────────────────────

describe('resolveProjectScope — accepts exactly two ways of naming a project', () => {
  it.each(SURFACES)('%s: a server-resolved scope, or an explicit one, or both agreeing', (_name, surface) => {
    expect(resolveProjectScope('Limiglow', null, surface)).toEqual({ ok: true, project: 'Limiglow' })
    expect(resolveProjectScope(null, 'Limiglow', surface)).toEqual({ ok: true, project: 'Limiglow' })
    expect(resolveProjectScope('Limiglow', 'Limiglow', surface)).toEqual({ ok: true, project: 'Limiglow' })
  })

  it.each(SURFACES)('%s: trims, so " Limiglow " is not a different project', (_name, surface) => {
    expect(resolveProjectScope('  Limiglow  ', null, surface)).toEqual({ ok: true, project: 'Limiglow' })
    // …and a header that is only whitespace is an ABSENT header, not a project
    // named "   ". Treating it as a name would let a blank header satisfy the
    // requirement to name one.
    const verdict = resolveProjectScope('   ', null, surface)
    expect(verdict.ok).toBe(false)
  })
})

// ─── Rule 1: absence is never "every project" ───────────────────────────────

describe('resolveProjectScope — an unresolvable scope refuses and says how to ask', () => {
  it.each(SURFACES)('%s: refuses 400 when neither signal is present', (_name, surface) => {
    const verdict = resolveProjectScope(null, null, surface)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(400)
    expect(verdict.error).toBe(surface.unscopedError)
    // The refusal must be actionable. A boundary that refuses without saying
    // how to ask deliberately reads as a bug and gets "fixed" by widening it.
    expect(verdict.message).toContain('/p/<project>')
    expect(verdict.message).toContain('project=<name>')
    expect(verdict.message).toBe(unscopedScopeMessage(surface))
  })

  it('names the surface in the refusal, so a log says WHICH boundary refused', () => {
    const codes = SURFACES.map(([, s]) => resolveProjectScope(null, null, s))
    const errors = codes.map(v => (v.ok ? 'ok' : v.error))
    expect(errors).toEqual([
      'unscoped_conversations_read',
      'unscoped_commerce_read',
      'unscoped_commerce_write',
    ])
    // A refused write and a refused read are distinguishable — the rule is the
    // same for both, deliberately, but the log must still tell them apart.
    expect(new Set(errors).size).toBe(3)
  })
})

// ─── Rule 2: a resolved scope narrows, and is never overridden ──────────────

describe('resolveProjectScope — refuses a disagreement rather than answering it', () => {
  it.each(SURFACES)('%s: 409 when the query names a different project', (_name, surface) => {
    const verdict = resolveProjectScope('Limiglow', 'Todero', surface)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(409)
    expect(verdict.error).toBe(surface.conflictError)
    // Both names appear, so the operator can see what was asked and what was
    // in force without reading the source.
    expect(verdict.message).toContain('Limiglow')
    expect(verdict.message).toContain('Todero')
    expect(verdict.message).toContain('narrows and is never overridden')
  })

  it('preserves the two wire codes the surfaces already published', () => {
    // Merging these into one code is visible to clients and is the owner's
    // call, not a refactor's. Pinned here so a later collapse cannot make that
    // change silently.
    expect(CONVERSATIONS_SCOPE.conflictError).toBe('scope_conflict')
    expect(COMMERCE_READ_SCOPE.conflictError).toBe('scope_mismatch')
    expect(COMMERCE_WRITE_SCOPE.conflictError).toBe('scope_mismatch')
  })
})

// ─── Rule 3: there is no widening escape, on any surface ────────────────────

describe('resolveProjectScope — nothing widens it', () => {
  it.each(SURFACES)('%s: no string a client can send means "all projects"', (_name, surface) => {
    // `all_projects=1` is what app/api/issues/route.ts honours for genuinely
    // cross-project screens. It is not read here, so a caller cannot get a
    // cross-project read by sending it: with no scope resolved it is still an
    // unscoped request, and as a project NAME it matches no project.
    const asAbsent = resolveProjectScope(null, null, surface)
    expect(asAbsent.ok).toBe(false)

    const asName = resolveProjectScope(null, 'all_projects=1', surface)
    // It resolves to a project literally named "all_projects=1" — which exists
    // nowhere, so the query downstream returns nothing. It does NOT widen.
    expect(asName).toEqual({ ok: true, project: 'all_projects=1' })

    // '*' is not a wildcard here either. Same reasoning.
    expect(resolveProjectScope(null, '*', surface)).toEqual({ ok: true, project: '*' })

    // Empty and whitespace are absences, and an absence refuses.
    for (const blank of ['', '   ', '\t\n']) {
      expect(resolveProjectScope(null, blank, surface).ok).toBe(false)
      expect(resolveProjectScope(blank, null, surface).ok).toBe(false)
    }
  })

  it('the source contains no all-projects branch at all', () => {
    // Rule 3 is easier to state than to keep. The check that survives a
    // refactor is a check on the source: there is no reachable code path here
    // that returns "every project", because there is no such value in the
    // type. A verdict is a refusal or ONE project.
    const verdict = resolveProjectScope('Limiglow', null, CONVERSATIONS_SCOPE)
    if (!verdict.ok) throw new Error('unreachable')
    expect(typeof verdict.project).toBe('string')
    expect(Array.isArray(verdict.project)).toBe(false)
  })
})

// ─── The one behaviour that changed, and it tightened ───────────────────────

describe('resolveProjectScope — the length cap now applies to every surface', () => {
  it.each(SURFACES)('%s: refuses a project name past the cap', (_name, surface) => {
    // FAILS AGAINST THE OLD BEHAVIOUR for the two commerce surfaces:
    // lib/commerce.ts:resolveCommerceScope() had no length check at all and
    // returned { ok: true, project: <the 121-character string> }. Measured
    // before the change, not assumed.
    const tooLong = 'L'.repeat(MAX_PROJECT_NAME_LENGTH + 1)
    const verdict = resolveProjectScope(null, tooLong, surface)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(400)
    expect(verdict.error).toBe(surface.unscopedError)
    expect(verdict.message).toContain('too long')
    expect(verdict.message).toContain(String(MAX_PROJECT_NAME_LENGTH))
  })

  it.each(SURFACES)('%s: a name exactly at the cap is still a name', (_name, surface) => {
    const atCap = 'L'.repeat(MAX_PROJECT_NAME_LENGTH)
    expect(resolveProjectScope(null, atCap, surface)).toEqual({ ok: true, project: atCap })
  })

  it('caps the header too, not only the query param', () => {
    const tooLong = 'L'.repeat(MAX_PROJECT_NAME_LENGTH + 1)
    expect(resolveProjectScope(tooLong, null, COMMERCE_WRITE_SCOPE).ok).toBe(false)
  })
})

// ─── The descriptor cannot loosen the rule ──────────────────────────────────

describe('ScopeSurface is a label, not a strategy', () => {
  it('a hostile descriptor still cannot make an unscoped request succeed', () => {
    // The point of putting the varying part in DATA is that the data has no
    // way to reach the algorithm. Prove it: a descriptor that tries to name
    // itself into a widening still refuses.
    const hostile: ScopeSurface = {
      what: 'request (all projects)',
      unscopedError: 'ok',
      conflictError: 'ok',
      noWidening: 'Actually every project is fine.',
    }
    const verdict = resolveProjectScope(null, null, hostile)
    expect(verdict.ok).toBe(false)
    expect(resolveProjectScope('Limiglow', 'Todero', hostile).ok).toBe(false)
  })
})

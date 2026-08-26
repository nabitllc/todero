/**
 * __tests__/auth/login-surface-seam.test.ts — identity-sessions.
 *
 * ── THIS SUITE IS RED ON PURPOSE. IT IS NOT A BROKEN TEST. ───────────────────
 *
 * Two things this lane BUILT are not reachable from the product, and both fixes
 * live in files this lane does not own (`app/login/LoginForm.tsx` and whatever
 * nav surface gets a sign-out control). Round 2 disclosed neither in a gate:
 * one is described in §6 as "SEAM-1" and the other is offered in a route
 * comment as though shipping the endpoint were the same as shipping the
 * feature. Both stayed invisible while every gate was green.
 *
 * ── SEAM A: the JS login path is STILL AN OPEN REDIRECT ─────────────────────
 *
 * The SERVER path is genuinely fixed and I verified it today, all eight
 * payloads, on the success path of a real login against the running dev server:
 *
 *   POST /api/auth-form  password=<viewer>  from=//evil.example.com/x
 *     -> location: http://localhost:3000/
 *   ... same for /..//evil.example.com/steal?x=1 and /\evil.example.com
 *   from=/settings              -> location: http://localhost:3000/settings
 *   from=/p/limiglow/work?tab=1 -> location: http://localhost:3000/p/limiglow/work?tab=1
 *
 * The CLIENT path is not fixed. Measured today:
 *
 *   GET /login?from=https%3A%2F%2Fevil.example.com%2Fphish
 *     -> the delivered HTML contains `evil.example.com/phish` four times,
 *        including as the value of the hidden `from` input
 *
 * and `app/login/LoginForm.tsx` does, on the success branch of the fetch:
 *
 *   window.location.href = from        // unsanitised, straight from searchParams
 *
 * So a phishing link that lands an operator on Todero's real login page hands
 * them to another origin the moment they authenticate successfully — which is
 * the worst possible moment, because they have just proved the page was real.
 *
 * I HAVE NO BROWSER, so I did not execute that navigation. What I observed is
 * the source line and the hostile value being delivered into the page. The
 * assertion below is therefore a source assertion, and it says so.
 *
 * ── SEAM B: sign-out exists as an endpoint and does not exist as a feature ──
 *
 * `DELETE /api/auth` works — measured today, HTTP 200 with two expiring
 * Set-Cookie headers. Nothing calls it. Measured today across app/ components/
 * lib/: zero call sites for `DELETE /api/auth` or `intent=logout`, and zero
 * occurrences of any "sign out" / "log out" string in any .tsx. `mc-auth` is
 * httpOnly, so browser JS cannot clear it either: an operator on a shared
 * machine has NO way to end their session from inside the product.
 *
 * ── HOW TO MAKE THIS GREEN ──────────────────────────────────────────────────
 *
 * Apply the two diffs in the failure messages, reproduced in
 * docs/rebuild/pieces/pieces9/identity-sessions.md §S2. Both are small, and
 * SEAM A's calls a function this lane already ships and already tests:
 * `safeReturnPath` in app/api/auth-form/return-path.ts, which is the exact
 * function the server path uses and which is pinned by 34 tests across
 * return-path.test.ts and return-path-escape.test.ts.
 */

import fs from 'node:fs'
import path from 'node:path'
import { safeReturnPath } from '@/app/api/auth-form/return-path'

const root = process.cwd()
const LOGIN_FORM = path.join(root, 'app', 'login', 'LoginForm.tsx')

const SEAM_A_DIFF = `
--- a/app/login/LoginForm.tsx
+++ b/app/login/LoginForm.tsx
@@
 'use client'
 import { useState } from 'react'
 import { Button } from '@/components/ui'
 import { Input } from '@/components/ui'
+// The SAME function the no-JS path uses. Not a second implementation: the
+// open redirect survived its first fix precisely because two code paths
+// disagreed about what "safe" meant.
+import { safeReturnPath } from '@/app/api/auth-form/return-path'
@@
     if (res.ok) {
       // MC-522: use hard navigation instead of router.push + router.refresh.
       ...
-      window.location.href = from
+      // \`from\` arrives from searchParams and is attacker-controlled. Reduce it
+      // to a same-origin path before navigating, or a successful login hands
+      // the operator to another site at the moment they are most likely to
+      // trust the page.
+      window.location.href = safeReturnPath(from, window.location.origin)
     } else {
`

const SEAM_B_DIFF = `
Sign-out is an endpoint with no caller. Add ONE control that hits it, anywhere
an operator can reach — the nav surface is the orchestrator's call, not this
lane's. The endpoint contract, already shipped and tested:

    await fetch('/api/auth', { method: 'DELETE' })
    window.location.href = '/login'

or, for the no-JS path that already exists:

    <form action="/api/auth-form" method="POST">
      <input type="hidden" name="intent" value="logout" />
      <button type="submit">Sign out</button>
    </form>

Both clear the browser's copy of mc-auth and mc-role. NEITHER is a revocation
and the endpoint says so in its own response body: the credential is a shared
workspace password, so a retained copy of the cookie still authenticates.
Real revocation needs a session table — the plan is piece doc §8, and it is
deliberately NOT started in a wave where nine lanes are writing.
`

describe('SEAM A: the JS login path must not be an open redirect', () => {
  const src = fs.readFileSync(LOGIN_FORM, 'utf8')

  it('LoginForm sanitises `from` before assigning window.location', () => {
    const unsanitised = /window\.location\.href\s*=\s*from\b/.test(src)
    const sanitised = /window\.location\.href\s*=\s*safeReturnPath\(/.test(src)
    if (unsanitised || !sanitised) {
      throw new Error(
        'SEAM NOT APPLIED — app/login/LoginForm.tsx assigns the raw `from` value ' +
          'to window.location.href.\n' +
          'Measured today: GET /login?from=https%3A%2F%2Fevil.example.com%2Fphish ' +
          'delivers `evil.example.com/phish` into the page, and this line then ' +
          'navigates to it on the SUCCESS branch of a real login.\n' +
          'I have no browser and did not execute the navigation; what I observed ' +
          'is this source line and the delivered value.\n' +
          SEAM_A_DIFF,
      )
    }
  })

  it('REGRESSION GUARD: the sanitiser the seam calls already refuses the payloads', () => {
    // Green today and after. This is the proof that the seam's fix is a real
    // fix and not a hope — the function it calls is already correct here.
    const origin = 'http://localhost:3000'
    for (const payload of [
      'https://evil.example.com/phish',
      '//evil.example.com/x',
      '/\\evil.example.com',
      '/..//evil.example.com/steal?x=1',
      '/a/..//evil.example.com',
      '/./..//evil.example.com',
      '/../..//evil.example.com',
      '/..///evil.example.com',
      '/..//evil.example.com:8080/x',
    ]) {
      expect(safeReturnPath(payload, origin)).toBe('/')
    }
  })

  it('REGRESSION GUARD: and it still preserves the deep links operators use', () => {
    // The other direction. A sanitiser that answers '/' for everything would
    // pass the test above and break every deep link.
    const origin = 'http://localhost:3000'
    expect(safeReturnPath('/settings', origin)).toBe('/settings')
    expect(safeReturnPath('/work/epics', origin)).toBe('/work/epics')
    expect(safeReturnPath('/p/limiglow/work?tab=1', origin)).toBe('/p/limiglow/work?tab=1')
  })
})

describe('SEAM B: sign-out must be reachable from the product', () => {
  /** Every source file an operator-facing control could live in. */
  function sourceFiles(): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full)
      }
    }
    for (const d of ['app', 'components']) {
      const full = path.join(root, d)
      if (fs.existsSync(full)) walk(full)
    }
    // The endpoint's own two files obviously mention it; they are not callers.
    return out.filter(
      f => !f.includes(path.join('app', 'api', 'auth')) && !f.includes(path.join('app', 'api', 'auth-form')),
    )
  }

  it('something in the UI actually calls the sign-out endpoint', () => {
    const callers = sourceFiles().filter(f => {
      const s = fs.readFileSync(f, 'utf8')
      const deleteCall = /fetch\(\s*['"`]\/api\/auth['"`][\s\S]{0,200}?method:\s*['"`]DELETE['"`]/.test(s)
      const formIntent = /name=["']intent["'][\s\S]{0,80}?value=["']logout["']/.test(s)
      return deleteCall || formIntent
    })
    if (callers.length === 0) {
      throw new Error(
        'SEAM NOT APPLIED — sign-out is an endpoint with no caller.\n' +
          'Measured today: DELETE /api/auth answers 200 with two expiring ' +
          'Set-Cookie headers, and zero files under app/ or components/ call it. ' +
          'No "sign out" string appears in any .tsx. mc-auth is httpOnly so ' +
          'browser JS cannot clear it either — an operator on a shared machine ' +
          'has no way to end their session from inside the product.\n' +
          SEAM_B_DIFF,
      )
    }
    expect(callers.length).toBeGreaterThan(0)
  })
})

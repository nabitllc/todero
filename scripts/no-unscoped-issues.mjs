#!/usr/bin/env node
/**
 * Scope enforcement, proven by REQUEST — not by grep.
 *
 * ── why this file was rewritten twice ────────────────────────────────────────
 *
 * v1 scanned component source for `dbUrl('issues?...')` literals lacking a
 * project clause. A critic defeated it six ways: a trailing comment satisfied
 * the substring test, a table name in a variable evaded it, a literal split
 * across two lines evaded it, `fetch()` bypassed `dbUrl` entirely, and — worst
 * — its per-file exemption was a COUNT, so a listed file could trade a fixed
 * violation for a fresh one forever and stay green.
 *
 * v2 gave up on scanning components (correctly — enforcement had moved to the
 * seam) and instead asserted that certain identifiers were still present in
 * three files. Its own header claimed "satisfying all of them by accident — or
 * by leaving a comment behind after deleting the code — is not realistic."
 * The next critic did exactly that in three edits: an early `return` at the top
 * of the scoping function, a re-set of the header the middleware had just
 * stripped, and a hardcoded `null` scope. Every identifier survived as dead
 * code. Scope enforcement was 100% dead, both routes leaked, and this script
 * printed PASS.
 *
 * A guard that reports confidence it has not earned is worse than no guard.
 * Both previous versions asked "does the code LOOK right?" — a question source
 * text can always be made to answer yes.
 *
 * v3 asks the only question that matters: DOES THE SERVER LEAK? It sends real
 * requests to the running app and checks the responses. It cannot be satisfied
 * by a comment, an identifier, or dead code, because it never reads the source
 * at all.
 *
 * Requires the dev server. With no server it reports SKIP and exits 0 — an
 * unmeasurable guard must not masquerade as a passing one, and must not block
 * a commit either. `scripts/acceptance/run.mjs` owns the same territory when
 * the server is up; this exists so the smoke test carries the claim too.
 */

const BASE = process.env.TODERO_URL ?? 'http://localhost:3000'
const COOKIE = 'mc-auth=kaos2026; mc-role=owner'
const SCOPED_REFERER = `${BASE}/p/limiglow/work/board`
const FLEET_REFERER = `${BASE}/p/limiglow/fleet/team`

async function req(path, { referer, headers = {}, method = 'GET', body } = {}) {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        cookie: COOKIE,
        ...(referer ? { referer } : {}),
        ...headers,
      },
      // TOD-2419: `body` was silently dropped here, so the probe-row POST sent
      // nothing and the server refused it for missing fields. A parameter
      // accepted and ignored, inside the guard that exists to catch exactly
      // that class of defect.
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(15000),
    })
    return { status: res.status, body: await res.text() }
  } catch (e) {
    return { status: 0, body: String(e?.message ?? e) }
  }
}

// Is the server answering at all?
const health = await req('/login')
if (health.status === 0 || health.status === 404) {
  console.log('SKIP: scope guard needs the dev server; it is not serving. Not a pass.')
  process.exit(0)
}

/**
 * The probe row: any issue whose project is NOT the scoped one, and which the
 * probes below can actually SEE.
 *
 * TOD-2419. This used to select with `include_archived=1` and then probe
 * WITHOUT it. The only foreign row in this database is TOD-1, which is
 * archived, so every probe was filtered by the ARCHIVE clause before the SCOPE
 * clause ever mattered. A critic proved the consequence: it disabled project
 * narrowing outright in app/api/issues/route.ts and this guard still printed
 * "PASS: scope holds under 10 live probes". The guard's own header says a guard
 * reporting confidence it has not earned is worse than no guard. This was that.
 *
 * So: the probe row must be LIVE. An archived-only foreign row is a SKIP, never
 * a pass — and rather than skip, this creates a live one and removes it after.
 */
const SCOPED_PROJECT = 'Limiglow'
const PROBE_KEY_PREFIX = 'SCOPEPROBE'

async function findLiveForeign() {
  // Deliberately WITHOUT include_archived: this must be a row the probes can see.
  const inv = await req('/api/issues?limit=0&all_projects=1')
  try {
    const j = JSON.parse(inv.body)
    const rows = j?.data ?? j
    if (Array.isArray(rows)) return rows.find((r) => r?.project && r.project !== SCOPED_PROJECT) ?? null
  } catch {
    /* fall through */
  }
  return null
}

let foreign = await findLiveForeign()
let createdProbe = null

if (!foreign) {
  // Create one, so the guard tests the scope clause rather than the archive
  // clause. `sprint` is required by a CHECK constraint for non-backlog states,
  // so the probe is created in `backlog`.
  const key = `${PROBE_KEY_PREFIX}-${Date.now()}`
  const created = await req('/api/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_key: key,
      title: 'scope guard probe row — deleted by scripts/no-unscoped-issues.mjs',
      project: 'Todero',
      // `task` and `bug` require a parent feature; `ops` stands alone.
      type: 'ops',
      priority: 'low',
      assignee: 'builder',
      status: 'backlog',
      description: 'Transient probe row created by the scope guard to make a cross-project leak observable.',
      acceptance_criteria: 'Transient. If this row is still here, the guard died mid-run.',
    }),
  })
  if (created.status >= 200 && created.status < 300) {
    foreign = await findLiveForeign()
    if (foreign) createdProbe = foreign
  }
}

if (!foreign) {
  console.log(
    `SKIP: no LIVE issue outside "${SCOPED_PROJECT}" exists and one could not be created, ` +
      `so a leak is not observable. Not a pass. ` +
      `(An ARCHIVED foreign row does not count: the archive clause would hide it ` +
      `whether or not the scope clause works — see TOD-2419.)`,
  )
  process.exit(0)
}

/** Remove the probe row this run created, whatever the verdict. */
async function cleanupProbe() {
  if (!createdProbe?.id) return
  await req(`/api/issues?id=${encodeURIComponent(createdProbe.id)}`, { method: 'DELETE' })
}

const leaks = (body) => body.includes(foreign.project) || (foreign.task_key && body.includes(foreign.task_key))

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push({ name, detail })
}

// ── 1. a scoped read must not return another project's row ──────────────────
{
  const r = await req('/api/db/issues?select=id,task_key,project&limit=200', { referer: SCOPED_REFERER })
  check('db proxy, scoped', r.status === 200 && !leaks(r.body), `status ${r.status} :: ${r.body.slice(0, 160)}`)
}
{
  const r = await req('/api/issues?limit=0', { referer: SCOPED_REFERER })
  check('/api/issues, scoped', r.status === 200 && !leaks(r.body), `status ${r.status} :: ${r.body.slice(0, 160)}`)
}
{
  const r = await req('/api/activity-feed?limit=50', { referer: SCOPED_REFERER })
  check('activity feed, scoped', r.status === 200 && !leaks(r.body), `status ${r.status} :: ${r.body.slice(0, 160)}`)
}

// ── 2. a cross-project DESTINATION must not widen `issues` ──────────────────
// SearchOverlay is mounted on every screen, so Cmd-K on Fleet used to return
// another project's backlog while the same keystroke on Work returned nothing.
{
  const r = await req('/api/db/issues?select=id,task_key,project&limit=200', { referer: FLEET_REFERER })
  check('db proxy, fleet destination', !leaks(r.body), `status ${r.status} :: ${r.body.slice(0, 160)}`)
}

// ── 3. an unresolvable scope must REFUSE, not widen ─────────────────────────
for (const [name, path] of [
  ['db proxy', '/api/db/issues?select=id,project&limit=200'],
  ['/api/issues', '/api/issues?limit=0'],
  ['activity feed', '/api/activity-feed?limit=50'],
]) {
  const r = await req(path)
  check(`${name}, no referer, refuses`, r.status === 400, `status ${r.status} :: ${r.body.slice(0, 160)}`)
}

// ── 4. neither scope header may be forged by the caller ─────────────────────
for (const [name, headers] of [
  ['x-mc-project', { 'x-mc-project': foreign.project }],
  ['x-mc-all-projects', { 'x-mc-all-projects': '1' }],
]) {
  const r = await req('/api/db/issues?select=id,project&limit=200', { referer: SCOPED_REFERER, headers })
  check(`forged ${name} ignored`, r.status === 200 && !leaks(r.body), `status ${r.status} :: ${r.body.slice(0, 160)}`)
}

// ── 5. a client filter may narrow, never override ───────────────────────────
{
  const r = await req(`/api/db/issues?select=id,project&project=eq.${encodeURIComponent(foreign.project)}&limit=200`, {
    referer: SCOPED_REFERER,
  })
  check('query filter cannot override scope', !leaks(r.body), `status ${r.status} :: ${r.body.slice(0, 160)}`)
}

// ── 6. the write path is not a read channel ─────────────────────────────────
// PATCH echoes affected rows, so an unscoped write returned rows the same
// caller is refused on GET — and mutated them on the way.
{
  const r = await req('/api/db/issues?task_number=gte.0', { referer: SCOPED_REFERER, method: 'PATCH' })
  check('write path scoped', !leaks(r.body), `status ${r.status} :: ${r.body.slice(0, 160)}`)
}

// ── 7/8. OPEN DECISION (docs/rebuild/LOOP-PLAN.md), resolved as option 1 ────
// `GET /api/db/issues?project=eq.Limiglow&...` used to 400 from a Fleet
// referer and 200 from a Work referer, for the identical query — the caller
// had already resolved its own boundary and the guard refused to take yes for
// an answer. Both directions are probed, by REQUEST, not by reading the fix:
//   7. the newly-allowed case must now pass: an explicit `project=eq.<x>`
//      filter that repeats the SAME project FLEET_REFERER's own `/p/<slug>`
//      names (`SCOPED_PROJECT`, here) satisfies scope.
//   8. the identical shape, naming a DIFFERENT (foreign) project, must still
//      refuse — this is not "any project filter satisfies scope", it is
//      "the ONE project this request already names, and no other".
{
  const r = await req(
    `/api/db/issues?select=id,project&project=eq.${encodeURIComponent(SCOPED_PROJECT)}&limit=5`,
    { referer: FLEET_REFERER },
  )
  check(
    'fleet destination + explicit in-scope project filter -> 200 (was 400)',
    r.status === 200,
    `status ${r.status} :: ${r.body.slice(0, 160)}`,
  )
}
{
  const r = await req(
    `/api/db/issues?select=id,project&project=eq.${encodeURIComponent(foreign.project)}&limit=200`,
    { referer: FLEET_REFERER },
  )
  check(
    'fleet destination + explicit FOREIGN project filter still refuses',
    r.status === 400 && !leaks(r.body),
    `status ${r.status} :: ${r.body.slice(0, 160)}`,
  )
}

await cleanupProbe()

if (failures.length > 0) {
  console.error('FAIL: the server leaks across the project boundary.')
  console.error('')
  for (const f of failures) console.error(`  ${f.name}\n    ${f.detail}`)
  console.error('')
  console.error('  These are live requests against the running app, not a source scan —')
  console.error('  a comment or a stray identifier cannot satisfy them.')
  process.exit(1)
}

console.log(`PASS: scope holds under ${8 + 2} live probes (scoped reads, cross-project destination,`)
console.log(`      refusal without scope, forged headers, filter override, write path,`)
console.log(`      explicit in-scope filter from a cross-project destination — both directions).`)
console.log(`      Probe row: ${foreign.task_key ?? foreign.id} in "${foreign.project}".`)

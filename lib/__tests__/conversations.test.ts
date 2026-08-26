/**
 * customer-conversations piece — lib/conversations.ts and migration 063.
 *
 * Every case here is written to FAIL against the behaviour this piece replaces
 * or against the behaviour a careless version of it would have. The channel's
 * whole reason for existing is one owner sentence — "You approve; Todero sends"
 * — so the cases that matter most are the REFUSALS:
 *
 *   * a draft that is asked to become `sent` without an approval
 *   * a caller that tries to set `state` (or `sent_at`, or `approved_by`) on the
 *     way in, which is how "always a draft" would quietly stop being true
 *   * a request with no project scope, and one whose query param disagrees with
 *     the scope the server resolved
 *   * and — because a rule that lives only in TypeScript is a rule a direct SQL
 *     writer can walk around — the same send-without-approval refusal executed
 *     against BOTH real dialects of migration 063.
 *
 * The last block is the one that discriminates hardest. A schema with no CHECK
 * constraints passes every happy-path assertion in this file; it fails the
 * moment an unapproved `sent` row is offered to it and the database shrugs.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { PGlite } from '@electric-sql/pglite'

import {
  APPROVED_WAITING_NOTE,
  CHANNELS,
  DRAFT_CANNOT_SEND,
  MESSAGE_ACTIONS,
  SCOPE_CONFLICT_ERROR,
  UNSCOPED_ERROR,
  conversationsQuery,
  describeMessageState,
  emptyConversationsMessage,
  normalizeMessageRow,
  planTransition,
  resolveScope,
  toApprovedOutboundMessage,
  validateAction,
  validateInbound,
  validateMessage,
  verifyWebhookSecret,
  type ActionRequest,
  type MessageRow,
} from '../conversations'

const MIGRATIONS = join(__dirname, '..', '..', 'migrations')
const NOW = '2026-08-26T12:00:00.000Z'

function outbound(patch: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    conversation_id: 'c1',
    direction: 'outbound',
    state: 'draft',
    body: 'Hi — yes, we ship on Tuesdays.',
    author: 'grok-bot',
    created_at: '2026-08-26T11:00:00.000Z',
    approved_at: null,
    approved_by: null,
    sent_at: null,
    sent_via: null,
    external_id: null,
    reply_to_message_id: null,
    ...patch,
  }
}

const APPROVE: ActionRequest = { action: 'approve', approved_by: 'michael', sent_via: null }
const RECORD_SEND: ActionRequest = { action: 'record_send', approved_by: null, sent_via: 'whatsapp-cloud-api' }

// ─── The rule: a draft is never sent ────────────────────────────────────────

describe('planTransition — "You approve; Todero sends", in that order', () => {
  it('REFUSES draft -> sent, and says why in the owner\'s own terms', () => {
    const verdict = planTransition(outbound({ state: 'draft' }), RECORD_SEND, NOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(409)
    expect(verdict.why).toBe(DRAFT_CANNOT_SEND)
    expect(verdict.why).toContain('must be approved first')
  })

  it('has NO transition that produces a sent message from an unapproved one', () => {
    // Exhaustive over the two actions and every state a message can hold: the
    // only way to reach `sent` is from `approved`. This is the case that fails
    // if someone later adds a convenience "send now" edge.
    const states = ['received', 'draft', 'approved', 'sent'] as const
    const reachedSent: string[] = []
    for (const state of states) {
      for (const request of [APPROVE, RECORD_SEND]) {
        for (const direction of ['inbound', 'outbound'] as const) {
          const verdict = planTransition(outbound({ state, direction }), request, NOW)
          if (verdict.ok && verdict.value.state === 'sent') reachedSent.push(`${direction}/${state}/${request.action}`)
        }
      }
    }
    expect(reachedSent).toEqual(['outbound/approved/record_send'])
  })

  it('approves a draft and stamps who and when — never a bare state flip', () => {
    const verdict = planTransition(outbound({ state: 'draft' }), APPROVE, NOW)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.value).toEqual({ state: 'approved', approved_at: NOW, approved_by: 'michael' })
  })

  it('records a send only from approved, and requires what carried it', () => {
    const verdict = planTransition(outbound({ state: 'approved', approved_at: NOW, approved_by: 'michael' }), RECORD_SEND, NOW)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.value).toEqual({ state: 'sent', sent_at: NOW, sent_via: 'whatsapp-cloud-api' })
  })

  it('refuses a second approval, and names who already made the first', () => {
    const verdict = planTransition(
      outbound({ state: 'approved', approved_at: NOW, approved_by: 'michael' }),
      APPROVE,
      NOW,
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(409)
    expect(verdict.why).toContain('already approved by michael')
  })

  it('refuses to approve or re-send an already-sent message', () => {
    const sent = outbound({ state: 'sent', approved_at: NOW, approved_by: 'michael', sent_at: NOW, sent_via: 'x' })
    expect(planTransition(sent, APPROVE, NOW).ok).toBe(false)
    expect(planTransition(sent, RECORD_SEND, NOW).ok).toBe(false)
  })

  it('refuses to run the outbound lifecycle on an inbound message', () => {
    const verdict = planTransition(outbound({ direction: 'inbound', state: 'received' }), APPROVE, NOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.why).toContain('no approval lifecycle')
  })
})

// ─── The outbound adapter seam: a draft cannot reach it ─────────────────────
//
// `OutboundTransport` has zero implementations in this codebase (see its own
// header for why). What IS here, and provable without any transport existing,
// is that `toApprovedOutboundMessage()` — the only function that produces the
// value an implementation's `send()` accepts — refuses everything that is not
// a currently-approved outbound message. This is the test the deliverable
// asks for: proof that an unapproved draft cannot reach the adapter.

describe('toApprovedOutboundMessage — the only door onto OutboundTransport.send()', () => {
  it('REFUSES a draft, with the exact sentence planTransition uses for the same rule', () => {
    const verdict = toApprovedOutboundMessage(outbound({ state: 'draft' }))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(409)
    expect(verdict.why).toBe(DRAFT_CANNOT_SEND)
  })

  it('REFUSES an approved row missing either stamp — never trusts state alone', () => {
    const missingApprover = outbound({ state: 'approved', approved_at: NOW, approved_by: null })
    expect(toApprovedOutboundMessage(missingApprover).ok).toBe(false)
    const missingStamp = outbound({ state: 'approved', approved_at: null, approved_by: 'michael' })
    expect(toApprovedOutboundMessage(missingStamp).ok).toBe(false)
  })

  it('REFUSES an inbound message regardless of its state', () => {
    const verdict = toApprovedOutboundMessage(outbound({ direction: 'inbound', state: 'received' }))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.why).toContain('never sent to a customer through this seam')
  })

  it('ACCEPTS an approved outbound message and narrows the nullable stamps to real strings', () => {
    const row = outbound({ state: 'approved', approved_at: NOW, approved_by: 'michael' })
    const verdict = toApprovedOutboundMessage(row)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.value).toEqual({
      id: row.id,
      conversation_id: row.conversation_id,
      body: row.body,
      approved_at: NOW,
      approved_by: 'michael',
    })
    // The type system's half of the proof: `approved_at`/`approved_by` are
    // typed `string`, not `string | null`, on `ApprovedOutboundMessage` — the
    // line below only compiles because verdict.value narrowed them. A draft's
    // `approved_at: null` could never be assigned here; `npx tsc --noEmit`
    // failing on this line IS the type-level half of this test.
    const stillApprovedAt: string = verdict.value.approved_at
    expect(stillApprovedAt).toBe(NOW)
  })

  it('this module still makes no outbound request of its own — the mechanical proof the piece doc cites', () => {
    // Same grep the piece doc runs over every file this piece owns: this file
    // adds an adapter INTERFACE and a webhook-secret CHECK, neither of which
    // is an outbound call. If either accidentally grew a real request, this
    // is the test that would catch it.
    const source = readFileSync(join(__dirname, '..', 'conversations.ts'), 'utf8')
    // Strip comment lines first: one of them QUOTES this exact grep pattern
    // as documentation, which would otherwise make this test detect its own
    // sentence describing the guarantee rather than a violation of it.
    const code = source
      .split('\n')
      .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n')
    expect(code).not.toMatch(/fetch\(|https?:\/\/|axios|WebSocket/)
  })
})

// ─── Inbound webhook authentication: refused both ways ──────────────────────

describe('verifyWebhookSecret — a dedicated credential, refused both ways', () => {
  const ENV_KEY = 'CONVERSATIONS_WEBHOOK_SECRET'
  const CONFIGURED_VALUE = 'a-fake-secret-for-tests-only-0123456789'
  let previous: string | undefined

  beforeAll(() => { previous = process.env[ENV_KEY] })
  afterAll(() => {
    if (previous === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = previous
  })

  it('reports no credential presented when the header is absent — falls through to RBAC', () => {
    process.env[ENV_KEY] = CONFIGURED_VALUE
    expect(verifyWebhookSecret(null)).toEqual({ presented: false })
    expect(verifyWebhookSecret(undefined)).toEqual({ presented: false })
    expect(verifyWebhookSecret('')).toEqual({ presented: false })
  })

  it('REFUSES a wrong secret outright — never falls through to a weaker check', () => {
    process.env[ENV_KEY] = CONFIGURED_VALUE
    expect(verifyWebhookSecret('guessed-wrong-value')).toEqual({ presented: true, valid: false })
  })

  it('ACCEPTS the exact configured secret', () => {
    process.env[ENV_KEY] = CONFIGURED_VALUE
    expect(verifyWebhookSecret(CONFIGURED_VALUE)).toEqual({ presented: true, valid: true })
  })

  it('refuses EVERY presented value when nothing is configured — absence of config never grants access', () => {
    delete process.env[ENV_KEY]
    expect(verifyWebhookSecret('anything-at-all')).toEqual({ presented: true, valid: false })
  })

  it('refuses a configured secret that is suspiciously short, the same way', () => {
    process.env[ENV_KEY] = 'short'
    expect(verifyWebhookSecret('short')).toEqual({ presented: true, valid: false })
  })
})

// ─── The write seam: the caller never chooses the state ─────────────────────

describe('validateMessage — an outbound message is ALWAYS created as a draft', () => {
  it('derives state from direction, with no way to ask for another', () => {
    const out = validateMessage({ direction: 'outbound', body: 'hello', author: 'grok-bot' })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('unreachable')
    expect(out.value.state).toBe('draft')

    const inb = validateMessage({ direction: 'inbound', body: 'hello' })
    expect(inb.ok).toBe(true)
    if (!inb.ok) throw new Error('unreachable')
    expect(inb.value.state).toBe('received')
  })

  it('REFUSES a caller-supplied state with a 400 that explains the rule', () => {
    // The failure mode this forbids is not "the state is ignored" — it is that a
    // caller could see `state` in its own request, get a 201 back, and
    // reasonably conclude it took effect. Accepted-and-ignored is the defect a
    // previous round of this rebuild shipped.
    const verdict = validateMessage({ direction: 'outbound', body: 'hi', state: 'sent' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(400)
    expect(verdict.why).toContain('"state" is not yours to set')
    expect(verdict.why).toContain('always created as a draft')
  })

  it('REFUSES every other lifecycle column too, each with its own reason', () => {
    for (const key of ['approved_at', 'approved_by', 'sent_at', 'sent_via']) {
      const verdict = validateMessage({ direction: 'outbound', body: 'hi', [key]: 'x' })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) throw new Error('unreachable')
      expect(verdict.status).toBe(400)
      expect(verdict.why).toContain(`"${key}" is not yours to set`)
    }
  })

  it('REFUSES an unknown key and names the ones it accepts', () => {
    const verdict = validateMessage({ direction: 'outbound', body: 'hi', urgency: 'high' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(400)
    expect(verdict.why).toBe('unknown field "urgency" — accepted fields: direction, body, author, reply_to_message_id')
  })

  it('rejects a blank body, a missing direction and an invented direction', () => {
    expect(validateMessage({ direction: 'outbound', body: '   ' }).ok).toBe(false)
    expect(validateMessage({ body: 'hi' }).ok).toBe(false)
    expect(validateMessage({ direction: 'sideways', body: 'hi' }).ok).toBe(false)
    expect(validateMessage('not an object').ok).toBe(false)
    expect(validateMessage([{ direction: 'outbound', body: 'hi' }]).ok).toBe(false)
  })

  it('rejects an author on an inbound message — the contact is the author', () => {
    const verdict = validateMessage({ direction: 'inbound', body: 'hi', author: 'grok-bot' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(422)
  })

  it('accepts reply_to_message_id on an outbound draft — the finer thread grain', () => {
    const verdict = validateMessage({ direction: 'outbound', body: 'yes, in stock', reply_to_message_id: 'm-1' })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.value.reply_to_message_id).toBe('m-1')
  })

  it('REFUSES reply_to_message_id on an inbound message — a customer message never "replies to" one', () => {
    const verdict = validateMessage({ direction: 'inbound', body: 'hi', reply_to_message_id: 'm-1' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(422)
    expect(verdict.why).toContain('reply_to_message_id may not be set on an inbound message')
  })
})

describe('validateInbound — the inbound door has no direction parameter', () => {
  it('accepts a real arrival and trims it', () => {
    const verdict = validateInbound({ channel: 'whatsapp', contact: ' +15550100 ', body: ' is it in stock? ' })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.value).toEqual({
      channel: 'whatsapp',
      contact: '+15550100',
      contact_name: null,
      body: 'is it in stock?',
      external_id: null,
    })
  })

  it('REFUSES an unknown channel and lists the known ones', () => {
    const verdict = validateInbound({ channel: 'carrier-pigeon', contact: 'x', body: 'y' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(422)
    expect(verdict.why).toContain(CHANNELS.join(', '))
  })

  it('REFUSES a direction key — this endpoint cannot be turned into an outbound one', () => {
    const verdict = validateInbound({ channel: 'web', contact: 'x', body: 'y', direction: 'outbound' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(400)
    expect(verdict.why).toContain('unknown field "direction"')
  })

  it('accepts a provider event id — the idempotency key a real webhook needs', () => {
    const verdict = validateInbound({ channel: 'whatsapp', contact: 'x', body: 'y', external_id: 'wamid.ABC123' })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.value.external_id).toBe('wamid.ABC123')
  })

  it('treats a missing external_id as null, not an empty string', () => {
    const verdict = validateInbound({ channel: 'whatsapp', contact: 'x', body: 'y' })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.value.external_id).toBeNull()
  })
})

describe('validateAction — fail closed, like hub-settings', () => {
  it('REFUSES an unknown action and names the known ones', () => {
    const verdict = validateAction({ action: 'send_now' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(400)
    expect(verdict.why).toBe(`unknown action "send_now" — known actions: ${MESSAGE_ACTIONS.join(', ')}`)
  })

  it('refuses an approval that records no approver', () => {
    const verdict = validateAction({ action: 'approve' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(422)
    expect(verdict.why).toContain('must record who made it')
  })

  it('refuses a send record that cannot name what carried it', () => {
    const verdict = validateAction({ action: 'record_send' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(422)
    expect(verdict.why).toContain('a claim, not a record')
  })
})

// ─── Scope: refuse, never widen ─────────────────────────────────────────────

describe('resolveScope — an unresolvable scope refuses and says how to ask', () => {
  it('refuses when neither the server-resolved scope nor ?project= is present', () => {
    const verdict = resolveScope(null, null)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(400)
    expect(verdict.error).toBe(UNSCOPED_ERROR)
    expect(verdict.message).toContain('/p/<project>')
    expect(verdict.message).toContain('?project=<name>')
    expect(verdict.message).toContain('There is no all-projects view')
  })

  it('has NO widening escape — the string that widens the issues API does nothing here', () => {
    // app/api/issues/route.ts honours a deliberate cross-project read. This
    // endpoint has no such mode, so a caller cannot get one by asking for it:
    // whatever it puts in the query, it either names one project or is refused.
    for (const attempt of ['all_projects=1', '*', '', '   ']) {
      const verdict = resolveScope(null, attempt === 'all_projects=1' ? null : attempt)
      if (attempt === '*') {
        // '*' is not a wildcard here, it is a project name that matches nothing.
        expect(verdict.ok).toBe(true)
      } else {
        expect(verdict.ok).toBe(false)
      }
    }
  })

  it('refuses a query param that disagrees with the resolved scope, rather than answering it', () => {
    const verdict = resolveScope('Limiglow', 'Todero')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.status).toBe(409)
    expect(verdict.error).toBe(SCOPE_CONFLICT_ERROR)
    expect(verdict.message).toContain('narrows and is never overridden')
  })

  it('accepts the two honest cases: a resolved scope, or an explicit one', () => {
    expect(resolveScope('Limiglow', null)).toEqual({ ok: true, project: 'Limiglow' })
    expect(resolveScope(null, 'Limiglow')).toEqual({ ok: true, project: 'Limiglow' })
    expect(resolveScope('Limiglow', 'Limiglow')).toEqual({ ok: true, project: 'Limiglow' })
  })
})

// ─── Reading: the surface never invents a state ─────────────────────────────

describe('describeMessageState — read off the column, never inferred', () => {
  it('says an approved message is still waiting, and names what for', () => {
    const described = describeMessageState({ direction: 'outbound', state: 'approved', sent_via: null, approved_by: 'michael' })
    expect(described.label).toBe('Approved')
    expect(described.note).toBe(APPROVED_WAITING_NOTE)
    expect(described.note).toContain('Todero has no WhatsApp or web sender')
  })

  it('does NOT call a message sent because it happens to carry a sent_via', () => {
    // A half-written row (state still draft, sent_via somehow populated) reads
    // as a draft. Inferring "sent" from the presence of a column is how a
    // surface starts claiming deliveries that never happened.
    const described = describeMessageState({ direction: 'outbound', state: 'draft', sent_via: 'whatsapp', approved_by: null })
    expect(described.label).toBe('Draft')
    expect(described.note).toBe('Not sent. Needs your approval.')
  })

  it('shows an unknown state as itself rather than mapping it to a familiar word', () => {
    expect(describeMessageState({ direction: 'outbound', state: 'queued', sent_via: null, approved_by: null }).label).toBe('queued')
  })
})

describe('the surface strings the card renders', () => {
  it('names the project in the empty state', () => {
    expect(emptyConversationsMessage('Limiglow')).toBe(
      'No customer conversations for Limiglow yet — nothing has arrived on WhatsApp or on the site, ' +
        'and Todero has no channel connected to either.',
    )
  })

  it('prints the same query it fetches, project-encoded', () => {
    expect(conversationsQuery('Mission Control')).toBe('/api/conversations?project=Mission%20Control')
  })
})

describe('normalizeMessageRow — one dialect for two adapters', () => {
  it('turns an absent column into null, not undefined', () => {
    const row = normalizeMessageRow({ id: 'm1', conversation_id: 'c1', direction: 'outbound', state: 'draft', body: 'x', created_at: NOW })
    expect(row.approved_at).toBeNull()
    expect(row.sent_via).toBeNull()
    expect(row.author).toBeNull()
  })
})

// ─── The schema itself refuses ──────────────────────────────────────────────
//
// A rule enforced only in TypeScript is a rule any direct SQL writer walks
// around. These two blocks execute migration 063 — the real file, both
// dialects — and offer it rows the application would never produce.

describe('migrations/sqlite/063_conversations.sql — the database refuses an unapproved send', () => {
  let sqlite: InstanceType<typeof Database>

  beforeAll(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(readFileSync(join(MIGRATIONS, 'sqlite', '063_conversations.sql'), 'utf8'))
    sqlite
      .prepare(`INSERT INTO conversations (id, project, channel, contact) VALUES ('c1', 'Limiglow', 'whatsapp', '+15550100')`)
      .run()
  })

  afterAll(() => sqlite.close())

  const insert = (cols: string, values: string) =>
    sqlite.prepare(`INSERT INTO conversation_messages (conversation_id, ${cols}) VALUES ('c1', ${values})`).run()

  it('REJECTS state=sent with no approval', () => {
    expect(() =>
      insert("direction, state, body, sent_at, sent_via", "'outbound', 'sent', 'hi', '2026-08-26T12:00:00Z', 'whatsapp'"),
    ).toThrow(/CHECK constraint failed/i)
  })

  it('REJECTS state=sent with an approval but no send record', () => {
    expect(() =>
      insert("direction, state, body, approved_at, approved_by", "'outbound', 'sent', 'hi', '2026-08-26T12:00:00Z', 'michael'"),
    ).toThrow(/CHECK constraint failed/i)
  })

  it('REJECTS state=approved with no approved_at', () => {
    expect(() => insert('direction, state, body', "'outbound', 'approved', 'hi'")).toThrow(/CHECK constraint failed/i)
  })

  it('REJECTS an inbound message carrying the outbound lifecycle', () => {
    expect(() => insert('direction, state, body', "'inbound', 'draft', 'hi'")).toThrow(/CHECK constraint failed/i)
  })

  it('ACCEPTS the honest sequence: draft, then approved, then sent', () => {
    expect(() => insert('direction, state, body', "'outbound', 'draft', 'hi'")).not.toThrow()
    expect(() =>
      insert('direction, state, body, approved_at, approved_by', "'outbound', 'approved', 'hi', '2026-08-26T12:00:00Z', 'michael'"),
    ).not.toThrow()
    expect(() =>
      insert(
        'direction, state, body, approved_at, approved_by, sent_at, sent_via',
        "'outbound', 'sent', 'hi', '2026-08-26T12:00:00Z', 'michael', '2026-08-26T12:01:00Z', 'whatsapp'",
      ),
    ).not.toThrow()
  })

  it('keeps one thread per (project, channel, contact) — a reply threads', () => {
    expect(() =>
      sqlite.prepare(`INSERT INTO conversations (project, channel, contact) VALUES ('Limiglow', 'whatsapp', '+15550100')`).run(),
    ).toThrow(/UNIQUE constraint failed/i)
  })

  it('leaves last_message_at NULL on a thread nothing has arrived in', () => {
    const row = sqlite.prepare(`SELECT last_message_at FROM conversations WHERE id = 'c1'`).get() as { last_message_at: string | null }
    expect(row.last_message_at).toBeNull()
  })
})

describe('migrations/063_conversations.sql — the Postgres dialect refuses the same rows', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await PGlite.create()
    await pg.exec(readFileSync(join(MIGRATIONS, '063_conversations.sql'), 'utf8'))
    await pg.query(`INSERT INTO conversations (id, project, channel, contact)
                    VALUES ('11111111-1111-4111-8111-111111111111', 'Limiglow', 'whatsapp', '+15550100')`)
  }, 60_000)

  afterAll(async () => { await pg.close() })

  const insert = (cols: string, values: string) =>
    pg.query(
      `INSERT INTO conversation_messages (conversation_id, ${cols})
       VALUES ('11111111-1111-4111-8111-111111111111', ${values})`,
    )

  it('REJECTS state=sent with no approval', async () => {
    await expect(
      insert('direction, state, body, sent_at, sent_via', `'outbound', 'sent', 'hi', now(), 'whatsapp'`),
    ).rejects.toThrow(/conversation_messages_sent_needs_approval/)
  })

  it('REJECTS state=approved with no approved_at', async () => {
    await expect(insert('direction, state, body', `'outbound', 'approved', 'hi'`)).rejects.toThrow(
      /conversation_messages_approved_stamp/,
    )
  })

  it('REJECTS an inbound message carrying the outbound lifecycle', async () => {
    await expect(insert('direction, state, body', `'inbound', 'draft', 'hi'`)).rejects.toThrow(
      /conversation_messages_direction_state/,
    )
  })

  it('ACCEPTS the honest sequence', async () => {
    await expect(insert('direction, state, body', `'outbound', 'draft', 'hi'`)).resolves.toBeDefined()
    await expect(
      insert(
        'direction, state, body, approved_at, approved_by, sent_at, sent_via',
        `'outbound', 'sent', 'hi', now(), 'michael', now(), 'whatsapp'`,
      ),
    ).resolves.toBeDefined()
  })

  it('keeps one thread per (project, channel, contact)', async () => {
    await expect(
      pg.query(`INSERT INTO conversations (project, channel, contact) VALUES ('Limiglow', 'whatsapp', '+15550100')`),
    ).rejects.toThrow(/conversations_thread_unique/)
  })
})

// ─── Migration 070: a finer thread grain, and an idempotent inbound door ────
//
// Same discipline as the 063 blocks above: execute the REAL migration file,
// both dialects, and offer it rows the application would never produce. A
// test that only inserted one external_id once would pass against a schema
// with no unique index at all — the case that matters is the SECOND insert
// of the same provider event id.

describe('migrations/sqlite/070 — idempotent external_id, threaded replies', () => {
  let sqlite: InstanceType<typeof Database>

  beforeAll(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(readFileSync(join(MIGRATIONS, 'sqlite', '063_conversations.sql'), 'utf8'))
    sqlite.exec(readFileSync(join(MIGRATIONS, 'sqlite', '070_conversations_threads_and_idempotency.sql'), 'utf8'))
    sqlite
      .prepare(`INSERT INTO conversations (id, project, channel, contact) VALUES ('c1', 'Limiglow', 'whatsapp', '+15550100')`)
      .run()
  })

  afterAll(() => sqlite.close())

  it('REJECTS a second message with the same external_id — a retried webhook is not a second customer message', () => {
    sqlite
      .prepare(
        `INSERT INTO conversation_messages (conversation_id, direction, state, body, external_id) VALUES ('c1', 'inbound', 'received', 'hi', 'wamid-1')`,
      )
      .run()
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO conversation_messages (conversation_id, direction, state, body, external_id) VALUES ('c1', 'inbound', 'received', 'hi again', 'wamid-1')`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/i)
  })

  it('ACCEPTS any number of messages with NO external_id — the partial index does not collide on NULL', () => {
    expect(() =>
      sqlite
        .prepare(`INSERT INTO conversation_messages (conversation_id, direction, state, body) VALUES ('c1', 'inbound', 'received', 'a')`)
        .run(),
    ).not.toThrow()
    expect(() =>
      sqlite
        .prepare(`INSERT INTO conversation_messages (conversation_id, direction, state, body) VALUES ('c1', 'inbound', 'received', 'b')`)
        .run(),
    ).not.toThrow()
  })

  it('lets an outbound draft name the message it replies to', () => {
    const parent = sqlite
      .prepare(`INSERT INTO conversation_messages (conversation_id, direction, state, body) VALUES ('c1', 'inbound', 'received', 'is it in stock?') RETURNING id`)
      .get() as { id: string }
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO conversation_messages (conversation_id, direction, state, body, reply_to_message_id) VALUES ('c1', 'outbound', 'draft', 'yes', ?)`,
        )
        .run(parent.id),
    ).not.toThrow()
  })
})

describe('migrations/070 — the Postgres dialect keeps the same two rules', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await PGlite.create()
    await pg.exec(readFileSync(join(MIGRATIONS, '063_conversations.sql'), 'utf8'))
    await pg.exec(readFileSync(join(MIGRATIONS, '070_conversations_threads_and_idempotency.sql'), 'utf8'))
    await pg.query(`INSERT INTO conversations (id, project, channel, contact)
                    VALUES ('11111111-1111-4111-8111-111111111111', 'Limiglow', 'whatsapp', '+15550100')`)
  }, 60_000)

  afterAll(async () => { await pg.close() })

  it('REJECTS a second message with the same external_id', async () => {
    await pg.query(
      `INSERT INTO conversation_messages (conversation_id, direction, state, body, external_id)
       VALUES ('11111111-1111-4111-8111-111111111111', 'inbound', 'received', 'hi', 'wamid-1')`,
    )
    await expect(
      pg.query(
        `INSERT INTO conversation_messages (conversation_id, direction, state, body, external_id)
         VALUES ('11111111-1111-4111-8111-111111111111', 'inbound', 'received', 'hi again', 'wamid-1')`,
      ),
    ).rejects.toThrow(/conversation_messages_external_id_unique/)
  })

  it('ACCEPTS a self-referencing reply_to_message_id within the same thread', async () => {
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO conversation_messages (conversation_id, direction, state, body)
       VALUES ('11111111-1111-4111-8111-111111111111', 'inbound', 'received', 'is it in stock?') RETURNING id`,
    )
    const parentId = rows[0].id
    await expect(
      pg.query(
        `INSERT INTO conversation_messages (conversation_id, direction, state, body, reply_to_message_id)
         VALUES ('11111111-1111-4111-8111-111111111111', 'outbound', 'draft', 'yes', $1)`,
        [parentId],
      ),
    ).resolves.toBeDefined()
  })
})

// ─── The card, rendered ─────────────────────────────────────────────────────
//
// components/tabs/ConversationsTab.tsx is not mounted in app/page.tsx — wiring
// a card into the shell belongs to the orchestrator, and app/page.tsx is
// outside this piece's ownership. So the strings it puts on screen are pinned
// HERE instead of being described in prose: the component is rendered to static
// markup and the markup is read back.
//
// What this can and cannot prove is worth being exact about. React effects do
// not run during renderToStaticMarkup, so this covers the pre-fetch render —
// the title, the printed source, and the no-project-yet empty state. The
// loaded, empty and error bodies are pinned through the pure functions that
// produce their text (emptyConversationsMessage, describeMessageState) and were
// observed against the live API by request, not by screenshot.

describe('ConversationsTab — the strings the card puts on screen', () => {
  // Required lazily so the import cost lands only in this block.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const ConversationsTab = require('../../components/tabs/ConversationsTab').default

  it('asks one question as its title', () => {
    const html = renderToStaticMarkup(React.createElement(ConversationsTab, { projectFilter: 'Limiglow' }))
    expect(html).toContain('Who is waiting on a reply?')
  })

  it('prints the exact query it reads, as the card\'s source', () => {
    const html = renderToStaticMarkup(React.createElement(ConversationsTab, { projectFilter: 'Limiglow' }))
    expect(html).toContain('/api/conversations?project=Limiglow')
    expect(html).toContain(conversationsQuery('Limiglow'))
  })

  it('renders no metric before a real number has arrived — never a placeholder 0', () => {
    const html = renderToStaticMarkup(React.createElement(ConversationsTab, { projectFilter: 'Limiglow' }))
    expect(html).not.toContain('awaiting approval')
  })

  it('refuses to guess a scope: with no project it says so instead of listing everything', () => {
    const html = renderToStaticMarkup(React.createElement(ConversationsTab, { projectFilter: null }))
    expect(html).toContain('No project selected yet, so there is no conversation scope to read.')
    expect(html).toContain('/api/conversations — waiting for a project scope')
  })

  it('has no Send control anywhere in its markup', () => {
    const html = renderToStaticMarkup(React.createElement(ConversationsTab, { projectFilter: 'Limiglow' }))
    expect(html).not.toMatch(/>\s*Send\s*</)
  })
})

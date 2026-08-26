// lib/conversations.ts — customer-conversations piece (channel: Customer Conversations)
//
// The pure half of "draft, approve, send. In that order."
//
// No `lib/db` import, no `next/server` import, no React. Every function here
// takes plain data and returns plain data, which is what lets
// lib/__tests__/conversations.test.ts PROVE the refusals — a draft that cannot
// be sent, an unknown key that is rejected rather than stored, a scope that
// cannot be widened — instead of asserting them in a comment. The API route and
// the card both read this module, so a button label and the transition the
// server will actually perform cannot drift apart.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
//   The owner's words for this channel: "You approve; Todero sends."
//   `planTransition()` below is the only place an outbound message changes
//   state, and it has no edge from `draft` to `sent`. The database says the
//   same thing independently (migrations/063_conversations.sql's
//   `conversation_messages_sent_needs_approval` CHECK), so the rule survives a
//   writer that never comes through here at all.
//
// WHAT IS NOT HERE, AND WILL NOT BE
//   A transport. There is no WhatsApp client, no web-widget client, and no
//   outbound request to any address a customer could be reached at anywhere in
//   this piece. `record_send` records a send that something ELSE performed and
//   reported; it does not perform one.

// ─── Vocabularies ───────────────────────────────────────────────────────────
//
// Deliberately here rather than as CHECK constraints in migration 063 — see
// that file's header for the trade. A new channel is a change to this list and
// its validator, not a migration.

/** Channels a conversation can arrive on. */
export const CHANNELS = ['whatsapp', 'web'] as const
export type Channel = (typeof CHANNELS)[number]

// A thread's `status` deliberately has NO vocabulary constant here, and that is
// a statement about what this piece does rather than an omission. Nothing in it
// changes a status except the inbound door, which sets 'open' (and reopens a
// 'closed' thread when the contact writes again). There is no status-change
// endpoint, so a list of legal statuses would be a list nothing checks — and an
// exported vocabulary that no call site enforces is precisely the kind of guard
// this rebuild has twice shipped and twice been caught by. Add the constant with
// the endpoint that needs it, not before.

export const DIRECTIONS = ['inbound', 'outbound'] as const
export type Direction = (typeof DIRECTIONS)[number]

/**
 * Lifecycle of one MESSAGE. `received` belongs to inbound messages and nothing
 * else; `draft -> approved -> sent` is the outbound path, in that order, with
 * no shortcut. Migration 063's `conversation_messages_direction_state` CHECK
 * enforces the same pairing at the storage layer.
 */
export const MESSAGE_STATES = ['received', 'draft', 'approved', 'sent'] as const
export type MessageState = (typeof MESSAGE_STATES)[number]

// ─── Rows ───────────────────────────────────────────────────────────────────

export interface ConversationRow {
  id: string
  project: string
  channel: string
  contact: string
  contact_name: string | null
  status: string
  /** NULL until a message actually arrives. Never defaulted to created_at. */
  last_message_at: string | null
  created_at: string
}

export interface MessageRow {
  id: string
  conversation_id: string
  direction: string
  state: string
  body: string
  author: string | null
  created_at: string
  approved_at: string | null
  approved_by: string | null
  sent_at: string | null
  sent_via: string | null
}

// ─── Verdicts ───────────────────────────────────────────────────────────────

export type Verdict<T> = { ok: true; value: T } | { ok: false; why: string; status: 400 | 409 | 422 }

function required(raw: unknown, field: string, max: number): Verdict<string> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, why: `${field} is required and must be a non-empty string`, status: 422 }
  }
  if (raw.length > max) return { ok: false, why: `${field} must be ${max} characters or fewer`, status: 422 }
  return { ok: true, value: raw.trim() }
}

function optional(raw: unknown, field: string, max: number): Verdict<string | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, why: `${field} must be a string or null`, status: 422 }
  if (raw.length > max) return { ok: false, why: `${field} must be ${max} characters or fewer`, status: 422 }
  return { ok: true, value: raw.trim() }
}

/**
 * Keys a caller may never set, with the reason each one is refused. Sending one
 * is a 400 that NAMES it — never accepted-and-ignored, which is the defect a
 * previous round of this rebuild shipped (an API parameter accepted and then
 * silently dropped is worse than one that is missing: the caller can see it in
 * the request and reasonably concludes it took effect).
 */
export const LIFECYCLE_KEYS: Readonly<Record<string, string>> = {
  state: 'an outbound message is always created as a draft; it reaches "approved" only through PATCH …/messages/<id> with action "approve"',
  approved_at: 'the approval timestamp is stamped by the server at the moment of approval, never supplied by the caller',
  approved_by: 'the approver is supplied with the approve action itself, not with the draft',
  sent_at: 'a send is recorded by the transport that performed it, through action "record_send"',
  sent_via: 'a send is recorded by the transport that performed it, through action "record_send"',
}

function refuseUnknownKeys(body: Record<string, unknown>, known: readonly string[]): Verdict<true> {
  const allowed = new Set<string>(known)
  for (const key of Object.keys(body)) {
    if (allowed.has(key)) continue
    const lifecycleReason = LIFECYCLE_KEYS[key]
    if (lifecycleReason) {
      return {
        ok: false,
        status: 400,
        why: `"${key}" is not yours to set — ${lifecycleReason}`,
      }
    }
    return {
      ok: false,
      status: 400,
      why: `unknown field "${key}" — accepted fields: ${known.join(', ')}`,
    }
  }
  return { ok: true, value: true }
}

function asObject(body: unknown): Verdict<Record<string, unknown>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, why: 'body must be a JSON object', status: 400 }
  }
  return { ok: true, value: body as Record<string, unknown> }
}

// ─── Scope ──────────────────────────────────────────────────────────────────

/**
 * The refusal a caller gets when no project could be resolved. Exported so the
 * test can pin the wording: a boundary that refuses without saying how to ask
 * deliberately just reads as a bug.
 */
export const UNSCOPED_ERROR = 'unscoped_conversations_read'
export const UNSCOPED_MESSAGE =
  'This conversations request has no project scope. Request it from a /p/<project> screen, ' +
  'or pass ?project=<name> to name one deliberately. There is no all-projects view of ' +
  'customer conversations: a conversation belongs to exactly one project.'

export const SCOPE_CONFLICT_ERROR = 'scope_conflict'

export type ScopeVerdict =
  | { ok: true; project: string }
  | { ok: false; error: string; message: string; status: 400 | 409 }

/**
 * Resolve the one project this request may touch.
 *
 * `headerScope` is middleware.ts's `x-mc-project`, which the client cannot
 * forge (middleware deletes any inbound copy before recomputing it from the
 * request's own path or its Referer). `queryProject` is an explicit `?project=`,
 * which a script with no page context can use to say what it means.
 *
 * FAIL CLOSED, in three specific ways:
 *   1. Neither signal -> refuse (400). Absence is never "every project".
 *   2. Both signals, disagreeing -> refuse (409). A resolved scope NARROWS and
 *      is never overridden; answering the query param instead would make the
 *      address bar and the data on screen disagree.
 *   3. There is no widening escape hatch at all. `all_projects=1` — which
 *      app/api/issues/route.ts accepts for genuinely cross-project screens —
 *      has no meaning here and is not read, because no screen in this product
 *      shows one customer's thread next to another project's.
 */
export function resolveScope(headerScope: string | null, queryProject: string | null): ScopeVerdict {
  const header = headerScope?.trim() || null
  const query = queryProject?.trim() || null

  if (header && query && header !== query) {
    return {
      ok: false,
      error: SCOPE_CONFLICT_ERROR,
      status: 409,
      message:
        `This screen is scoped to "${header}" but the request asked for "${query}". ` +
        'A resolved scope narrows and is never overridden — ask from a /p/<project> screen for that project instead.',
    }
  }

  const project = header ?? query
  if (!project) {
    return { ok: false, error: UNSCOPED_ERROR, status: 400, message: UNSCOPED_MESSAGE }
  }
  if (project.length > 120) {
    return {
      ok: false,
      error: UNSCOPED_ERROR,
      status: 400,
      message: `project name is too long (${project.length} characters, maximum 120).`,
    }
  }
  return { ok: true, project }
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/** Accepted keys for POST /api/conversations — an INBOUND message arriving. */
export const INBOUND_KEYS = ['channel', 'contact', 'contact_name', 'body'] as const

export interface InboundWrite {
  channel: Channel
  contact: string
  contact_name: string | null
  body: string
}

/**
 * Validate an arriving customer message. There is no `direction` here on
 * purpose: this endpoint is the inbound door, and a caller that could set the
 * direction could create an outbound message that skipped the draft state.
 */
export function validateInbound(body: unknown): Verdict<InboundWrite> {
  const obj = asObject(body)
  if (!obj.ok) return obj
  const unknown = refuseUnknownKeys(obj.value, INBOUND_KEYS)
  if (!unknown.ok) return unknown

  const b = obj.value

  const channel = required(b.channel, 'channel', 40)
  if (!channel.ok) return channel
  if (!(CHANNELS as readonly string[]).includes(channel.value)) {
    return {
      ok: false,
      status: 422,
      why: `unknown channel "${channel.value}" — known channels: ${CHANNELS.join(', ')}`,
    }
  }

  const contact = required(b.contact, 'contact', 200)
  if (!contact.ok) return contact

  const contactName = optional(b.contact_name, 'contact_name', 200)
  if (!contactName.ok) return contactName

  const text = required(b.body, 'body', 20_000)
  if (!text.ok) return text

  return {
    ok: true,
    value: {
      channel: channel.value as Channel,
      contact: contact.value,
      contact_name: contactName.value,
      body: text.value,
    },
  }
}

/** Accepted keys for POST /api/conversations/<id>/messages. */
export const MESSAGE_KEYS = ['direction', 'body', 'author'] as const

export interface MessageWrite {
  direction: Direction
  state: MessageState
  body: string
  author: string | null
}

/**
 * Validate an appended message and DERIVE its state. The caller never chooses:
 *
 *   inbound  -> 'received'
 *   outbound -> 'draft', always, with no exception and no parameter.
 *
 * That single line is the "drafts while you are away" half of the owner's
 * sentence. The other half — approval — is a separate call by a different
 * permission (see app/api/conversations/[id]/messages/[messageId]/route.ts).
 */
export function validateMessage(body: unknown): Verdict<MessageWrite> {
  const obj = asObject(body)
  if (!obj.ok) return obj
  const unknown = refuseUnknownKeys(obj.value, MESSAGE_KEYS)
  if (!unknown.ok) return unknown

  const b = obj.value

  const direction = required(b.direction, 'direction', 20)
  if (!direction.ok) return direction
  if (!(DIRECTIONS as readonly string[]).includes(direction.value)) {
    return {
      ok: false,
      status: 422,
      why: `unknown direction "${direction.value}" — known directions: ${DIRECTIONS.join(', ')}`,
    }
  }

  const text = required(b.body, 'body', 20_000)
  if (!text.ok) return text

  const author = optional(b.author, 'author', 200)
  if (!author.ok) return author

  const dir = direction.value as Direction
  if (dir === 'inbound' && author.value) {
    // An inbound message's author is the thread's contact. Accepting a second
    // one here would create a place for the two to disagree.
    return {
      ok: false,
      status: 422,
      why: 'author may not be set on an inbound message — an inbound message is written by the conversation\'s contact',
    }
  }

  return {
    ok: true,
    value: { direction: dir, state: dir === 'inbound' ? 'received' : 'draft', body: text.value, author: author.value },
  }
}

// ─── Transitions ────────────────────────────────────────────────────────────

/** The two things a human (or a transport) can ask of an existing message. */
export const MESSAGE_ACTIONS = ['approve', 'record_send'] as const
export type MessageAction = (typeof MESSAGE_ACTIONS)[number]

export const ACTION_KEYS = ['action', 'approved_by', 'sent_via'] as const

export interface ActionRequest {
  action: MessageAction
  approved_by: string | null
  sent_via: string | null
}

/**
 * The sentence a `draft -> sent` attempt gets back. Exported and pinned by a
 * test because it is the single most important refusal in this piece: it is the
 * owner's rule, quoted back at the caller that tried to skip it.
 */
export const DRAFT_CANNOT_SEND =
  'a draft cannot be sent: it must be approved first — that is the whole rule this surface exists to enforce'

/** What an approved message is waiting for, stated instead of implied. */
export const APPROVED_WAITING_NOTE =
  'Approved — waiting for a transport. Todero has no WhatsApp or web sender; a send is recorded only when one reports it.'

export function validateAction(body: unknown): Verdict<ActionRequest> {
  const obj = asObject(body)
  if (!obj.ok) return obj
  const unknown = refuseUnknownKeys(obj.value, ACTION_KEYS)
  if (!unknown.ok) return unknown

  const b = obj.value
  const action = required(b.action, 'action', 40)
  if (!action.ok) return action
  if (!(MESSAGE_ACTIONS as readonly string[]).includes(action.value)) {
    return {
      ok: false,
      status: 400,
      why: `unknown action "${action.value}" — known actions: ${MESSAGE_ACTIONS.join(', ')}`,
    }
  }

  const approvedBy = optional(b.approved_by, 'approved_by', 200)
  if (!approvedBy.ok) return approvedBy
  const sentVia = optional(b.sent_via, 'sent_via', 200)
  if (!sentVia.ok) return sentVia

  if (action.value === 'approve' && !approvedBy.value) {
    // "You approve" — an approval with no approver is an approval nobody made.
    return { ok: false, status: 422, why: 'approve requires approved_by — an approval must record who made it' }
  }
  if (action.value === 'record_send' && !sentVia.value) {
    return {
      ok: false,
      status: 422,
      why: 'record_send requires sent_via — a send that cannot name what carried it is a claim, not a record',
    }
  }

  return {
    ok: true,
    value: { action: action.value as MessageAction, approved_by: approvedBy.value, sent_via: sentVia.value },
  }
}

/** The columns a transition writes. Nothing else on the row is touched. */
export interface TransitionPatch {
  state: MessageState
  approved_at?: string
  approved_by?: string
  sent_at?: string
  sent_via?: string
}

/**
 * The ONLY state machine for an outbound message.
 *
 *      draft --approve--> approved --record_send--> sent
 *
 * There is no other edge. In particular there is no `draft -> sent`, and there
 * is no automatic step: `approve` is only ever reached by an explicit request
 * from a caller holding `projects:admin`, and `record_send` only ever from a
 * message that is ALREADY approved.
 */
export function planTransition(
  row: Pick<MessageRow, 'direction' | 'state' | 'approved_at' | 'approved_by' | 'sent_at' | 'sent_via'>,
  request: ActionRequest,
  nowIso: string,
): Verdict<TransitionPatch> {
  if (row.direction !== 'outbound') {
    return {
      ok: false,
      status: 409,
      why: `an ${row.direction} message has no approval lifecycle — only an outbound reply is drafted, approved and sent`,
    }
  }

  if (request.action === 'approve') {
    if (row.state === 'approved') {
      return {
        ok: false,
        status: 409,
        why: `already approved${row.approved_by ? ` by ${row.approved_by}` : ''}${row.approved_at ? ` at ${row.approved_at}` : ''}`,
      }
    }
    if (row.state === 'sent') {
      return { ok: false, status: 409, why: `already sent${row.sent_at ? ` at ${row.sent_at}` : ''} — approving it now would change nothing` }
    }
    if (row.state !== 'draft') {
      return { ok: false, status: 409, why: `only a draft can be approved; this message is "${row.state}"` }
    }
    return {
      ok: true,
      value: { state: 'approved', approved_at: nowIso, approved_by: request.approved_by as string },
    }
  }

  // record_send
  if (row.state === 'draft') {
    return { ok: false, status: 409, why: DRAFT_CANNOT_SEND }
  }
  if (row.state === 'sent') {
    return {
      ok: false,
      status: 409,
      why: `already recorded as sent${row.sent_at ? ` at ${row.sent_at}` : ''}${row.sent_via ? ` via ${row.sent_via}` : ''}`,
    }
  }
  if (row.state !== 'approved') {
    return { ok: false, status: 409, why: `only an approved message can be recorded as sent; this message is "${row.state}"` }
  }
  return { ok: true, value: { state: 'sent', sent_at: nowIso, sent_via: request.sent_via as string } }
}

// ─── Reading ────────────────────────────────────────────────────────────────

/**
 * One dialect for two adapters. The sqlite host hands back the same TEXT
 * columns Postgres hands back as `timestamptz`, but a missing column arrives as
 * `undefined` rather than `null` on both — and `undefined` renders as nothing
 * while `null` is the value the UI branches on. Normalising here means the card
 * never has to ask which database answered.
 */
export function normalizeMessageRow(raw: Record<string, unknown>): MessageRow {
  const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  return {
    id: String(raw.id ?? ''),
    conversation_id: String(raw.conversation_id ?? ''),
    direction: String(raw.direction ?? ''),
    state: String(raw.state ?? ''),
    body: String(raw.body ?? ''),
    author: text(raw.author),
    created_at: String(raw.created_at ?? ''),
    approved_at: text(raw.approved_at),
    approved_by: text(raw.approved_by),
    sent_at: text(raw.sent_at),
    sent_via: text(raw.sent_via),
  }
}

export function normalizeConversationRow(raw: Record<string, unknown>): ConversationRow {
  const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  return {
    id: String(raw.id ?? ''),
    project: String(raw.project ?? ''),
    channel: String(raw.channel ?? ''),
    contact: String(raw.contact ?? ''),
    contact_name: text(raw.contact_name),
    status: String(raw.status ?? 'open'),
    last_message_at: text(raw.last_message_at),
    created_at: String(raw.created_at ?? ''),
  }
}

/**
 * What one message's state means, in words the surface renders verbatim. The
 * label is read off the `state` column — never inferred from the presence of a
 * timestamp, which would let a half-written row read as something it is not.
 */
export function describeMessageState(row: Pick<MessageRow, 'direction' | 'state' | 'sent_via' | 'approved_by'>): {
  label: string
  note: string | null
} {
  if (row.direction === 'inbound') return { label: 'Received', note: null }
  switch (row.state) {
    case 'draft':
      return { label: 'Draft', note: 'Not sent. Needs your approval.' }
    case 'approved':
      return { label: 'Approved', note: APPROVED_WAITING_NOTE }
    case 'sent':
      return { label: 'Sent', note: row.sent_via ? `Recorded as sent via ${row.sent_via}.` : null }
    default:
      // A state the vocabulary does not know is shown as itself rather than
      // mapped onto the nearest familiar word.
      return { label: row.state || 'unknown', note: null }
  }
}

/** The exact empty state. It names the project — never "No data". */
export function emptyConversationsMessage(project: string): string {
  return (
    `No customer conversations for ${project} yet — nothing has arrived on WhatsApp or on the site, ` +
    'and Todero has no channel connected to either.'
  )
}

/**
 * The endpoint the card fetches AND prints as its `source`. One function so the
 * two cannot diverge: a card that prints a query it did not run is a card that
 * lies about where its number came from.
 */
export function conversationsQuery(project: string): string {
  return `/api/conversations?project=${encodeURIComponent(project)}`
}

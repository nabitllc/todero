/**
 * The browser shim's filter grammar must land as ordinary `DbQueryBuilder`
 * calls, never as a query string handed to a vendor. These tests record the
 * calls a translated query makes, which is exactly what a future SQL-driver
 * adapter will have to answer.
 */

import type { DbQueryBuilder } from '../db'
import {
  applyFilters,
  applyShaping,
  DbQueryParseError,
  readQueryShape,
} from '../db/query-params'

type Call = [string, ...unknown[]]

/**
 * Records every builder call. Typed as the real interface via `unknown` so the
 * test exercises the same surface an adapter implements.
 */
function recorder(): { builder: DbQueryBuilder; calls: Call[] } {
  const calls: Call[] = []
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'then') return undefined
      return (...args: unknown[]) => {
        calls.push([prop, ...args])
        return proxy
      }
    },
  }
  const proxy = new Proxy({}, handler) as unknown as DbQueryBuilder
  return { builder: proxy, calls }
}

function translate(query: string): Call[] {
  const params = new URLSearchParams(query)
  const { builder, calls } = recorder()
  applyShaping(applyFilters(builder, params), params)
  return calls
}

describe('query-string → seam translation', () => {
  it('reads the column list, defaulting to *', () => {
    expect(readQueryShape(new URLSearchParams('select=id,title')).select).toBe('id,title')
    expect(readQueryShape(new URLSearchParams('limit=5')).select).toBe('*')
  })

  it('maps comparison operators onto their own methods', () => {
    expect(translate('status=eq.open&priority=neq.low&created_at=gte.2026-01-01&created_at=lt.2026-02-01'))
      .toEqual([
        ['eq', 'status', 'open'],
        ['neq', 'priority', 'low'],
        ['gte', 'created_at', '2026-01-01'],
        ['lt', 'created_at', '2026-02-01'],
      ])
  })

  it('turns in.(a,b) into a real value list', () => {
    expect(translate('status=in.(open,in_progress,code_review)')).toEqual([
      ['in', 'status', ['open', 'in_progress', 'code_review']],
    ])
  })

  it('turns is.null and not.is.null into is()/not()', () => {
    expect(translate('sprint=not.is.null&blocked_by=is.null&is_blocked=eq.false')).toEqual([
      ['not', 'sprint', 'is', null],
      ['is', 'blocked_by', null],
      ['eq', 'is_blocked', 'false'],
    ])
  })

  it('negates a value list as an array, not a parenthesised string', () => {
    expect(translate('status=not.in.(completed,released,closed)')).toEqual([
      ['not', 'status', 'in', ['completed', 'released', 'closed']],
    ])
  })

  it('turns an or() group into predicates, so no adapter has to parse grammar', () => {
    expect(translate('or=(assignee.eq.kaos,assignee.eq.global)&status=eq.open')).toEqual([
      ['eq', 'status', 'open'],
      [
        'or',
        [
          { column: 'assignee', op: 'eq', value: 'kaos' },
          { column: 'assignee', op: 'eq', value: 'global' },
        ],
      ],
    ])
  })

  it('reads every operator an or() term may carry', () => {
    expect(translate('or=(sprint.is.null,doc_type.in.(soul,agents),content.ilike.kaos%25)')).toEqual([
      [
        'or',
        [
          { column: 'sprint', op: 'is', value: null },
          { column: 'doc_type', op: 'in', value: ['soul', 'agents'] },
          { column: 'content', op: 'ilike', value: 'kaos%' },
        ],
      ],
    ])
  })

  it('refuses an or() term that is not column.operator.value', () => {
    expect(() => translate('or=(blocked_by)')).toThrow(DbQueryParseError)
    expect(() => translate('or=(blocked_by.bogus.1)')).toThrow(DbQueryParseError)
  })

  it('splits multi-column ordering and reads its modifiers', () => {
    expect(translate('order=priority.asc,due_date.asc.nullslast,created_at.desc')).toEqual([
      ['order', 'priority', { ascending: true }],
      ['order', 'due_date', { ascending: true, nullsFirst: false }],
      ['order', 'created_at', { ascending: false }],
    ])
  })

  it('maps limit to limit() and offset to an inclusive row window', () => {
    expect(translate('limit=20')).toEqual([['limit', 20]])
    expect(translate('limit=20&offset=40')).toEqual([['range', 40, 59]])
  })

  it('never treats a shaping key as a filter', () => {
    expect(translate('select=id&limit=1&on_conflict=agent_id,key')).toEqual([['limit', 1]])
  })

  it('rejects a filter it cannot express instead of guessing', () => {
    expect(() => translate('status=bogus.open')).toThrow(DbQueryParseError)
    expect(() => translate('status=open')).toThrow(/<operator>\.<value>/)
    expect(() => translate('drop table=eq.1')).toThrow(/Invalid filter column/)
    expect(() => translate('order=1;drop.asc')).toThrow(/Invalid order column/)
  })
})

// __tests__/work-ui-wiring.test.tsx — Work Management UI, ROUND 3.
//
// ═════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS
// ═════════════════════════════════════════════════════════════════════════════
// Round 1's defect: the tests covered the pure helpers and never the
// components. Round 2's repair split each component into a pure view plus
// exported request functions and tested those — which MOVED the untested layer
// rather than removing it. The thin wiring that `app/page.tsx` actually mounts
// (the default exports) still had zero tests, and a fresh-context critic
// mutation-tested it: 32 mutations, 12 survived at 51/51 green, including
// verbatim TOD-2444 (`children={undefined}` after the `{...props}` spread in
// WorkViewCard's default export deletes the entire IssuesTab).
//
// Round 2 also shipped five "source guards" — `expect(src).toContain('…')` —
// over that wiring. Those are string greps, not behaviour, and the critic
// defeated every one of them with a one-token edit that leaves the guarded
// string intact: `{false && writeError && (`, `if (false && error) {`,
// `const retryFailedWrite = () => { return`. They are deleted in this round and
// replaced by what is below.
//
// ═════════════════════════════════════════════════════════════════════════════
// HOW A BUTTON GETS PRESSED WITHOUT A DOM
// ═════════════════════════════════════════════════════════════════════════════
// Round 2 stated — correctly at the time — that this repo's jest is
// `testEnvironment: "node"` with no jsdom and no @testing-library, so effects
// never run and nothing can be clicked. MEASURED again today, 2026-08-26:
//
//   ls node_modules/@testing-library          -> no such directory
//   ls node_modules/jsdom                     -> no such directory
//   ls node_modules/jest-environment-jsdom    -> no such directory
//   ls node_modules/react-test-renderer       -> no such directory
//
// So none of those are available, and package.json / jest.config.js are not
// this lane's files. What round 2 missed is that **none of them is required**.
// React's hooks are not implemented in `react`; they are forwarded at call time
// to whatever object sits in `ReactCurrentDispatcher.current`. Supply that
// object and a function component can be invoked directly, its `useEffect`
// callbacks run when we choose to run them, its `useState` setters mark a tree
// dirty, and the element tree it returns is a plain JS object graph whose host
// nodes still carry their real `onClick` / `onChange` props.
//
// That is the whole harness below (~180 lines, no new dependency). It is a
// miniature React: hooks, effects with dependency arrays and cleanups, state
// updates, re-render to fixpoint, and event dispatch into the real handlers.
//
// WHAT THIS DOES AND DOES NOT PROVE
// ---------------------------------
//   DOES: the DEFAULT exports are mounted — the exact components app/page.tsx
//   renders — with their real children, real `useApiList`/`useAgentRoster`
//   loads against a mocked `global.fetch`, and their real buttons invoked
//   through the props React would have handed the browser. Every assertion is
//   against the rendered tree or the recorded requests.
//
//   DOES NOT: this is not a browser. There is no layout, no CSS, no focus
//   management, no event bubbling or capture, no `preventDefault` semantics, no
//   HTML5 drag-and-drop, and no screen reader. A `role`/`tabIndex` assertion
//   here proves the attribute is emitted, NOT that assistive tech behaves. And
//   `onKeyDown` firing here does not prove the element is reachable by Tab in a
//   real browser. Those claims need a browser and this lane has none.
//
// The 12 surviving mutants are named against the tests that kill them, so a
// fresh critic can re-apply each one and watch it fail rather than trust this
// header.
// ═════════════════════════════════════════════════════════════════════════════

import React from 'react'
import IssuesTab from '@/components/tabs/IssuesTab'
import WorkViewCard from '@/components/tabs/WorkViewCard'
import FeatureCard from '@/components/tabs/FeatureCard'
import { KanbanCard } from '@/components/KanbanCard'
import type { Task } from '@/lib/issues'

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE HARNESS
// ═════════════════════════════════════════════════════════════════════════════

type RNode =
  | { kind: 'text'; text: string }
  | { kind: 'host'; type: string; props: any; children: RNode[] }

interface Cell {
  init?: boolean
  value?: any
  deps?: any[]
  setter?: any
  cleanup?: any
}

const INTERNALS: any = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
const FORWARD_REF = Symbol.for('react.forward_ref')
const MEMO = Symbol.for('react.memo')

function depsEqual(a?: any[], b?: any[]): boolean {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
  return true
}

/** A miniature React: real hooks, real effects, real event props. */
class Mounted {
  private element: React.ReactElement
  private fibers = new Map<string, Cell[]>()
  private cells: Cell[] | null = null
  private idx = 0
  private effects: Array<() => void> = []
  private dirty = false
  private ids = 0
  /** Number of full render passes — a runaway loop shows up here. */
  passes = 0
  tree: RNode[] = []

  constructor(element: React.ReactElement) {
    this.element = element
  }

  private cell(): Cell {
    const list = this.cells!
    if (!list[this.idx]) list[this.idx] = {}
    return list[this.idx++]
  }

  private dispatcher = {
    useState: (initial: any) => {
      const c = this.cell()
      if (!c.init) {
        c.init = true
        c.value = typeof initial === 'function' ? initial() : initial
        c.setter = (u: any) => {
          const next = typeof u === 'function' ? u(c.value) : u
          if (Object.is(next, c.value)) return
          c.value = next
          this.dirty = true
        }
      }
      return [c.value, c.setter]
    },
    useReducer: (reducer: any, initArg: any, init?: any) => {
      const c = this.cell()
      if (!c.init) {
        c.init = true
        c.value = init ? init(initArg) : initArg
        c.setter = (action: any) => {
          const next = reducer(c.value, action)
          if (Object.is(next, c.value)) return
          c.value = next
          this.dirty = true
        }
      }
      return [c.value, c.setter]
    },
    useEffect: (create: () => any, deps?: any[]) => {
      const c = this.cell()
      const changed = !c.init || !depsEqual(c.deps, deps)
      c.init = true
      c.deps = deps
      if (changed) {
        this.effects.push(() => {
          if (typeof c.cleanup === 'function') c.cleanup()
          c.cleanup = create()
        })
      }
    },
    useMemo: (fn: () => any, deps?: any[]) => {
      const c = this.cell()
      if (!c.init || !depsEqual(c.deps, deps)) {
        c.init = true
        c.deps = deps
        c.value = fn()
      }
      return c.value
    },
    useRef: (initial: any) => {
      const c = this.cell()
      if (!c.init) {
        c.init = true
        c.value = { current: initial }
      }
      return c.value
    },
    useContext: (ctx: any) => ctx?._currentValue,
    readContext: (ctx: any) => ctx?._currentValue,
    useDebugValue: () => {},
    useImperativeHandle: () => {},
    useId: () => `:h${this.ids++}:`,
    useDeferredValue: (v: any) => v,
    useTransition: () => [false, (cb: () => void) => cb()],
    useSyncExternalStore: (_s: any, get: any, getServer?: any) => (getServer ?? get)(),
    useInsertionEffect: () => {},
  } as any

  // useLayoutEffect and useCallback are the same machinery as their siblings.
  private wire() {
    this.dispatcher.useLayoutEffect = this.dispatcher.useEffect
    this.dispatcher.useCallback = (fn: any, deps?: any[]) => this.dispatcher.useMemo(() => fn, deps)
  }

  private renderInto(node: any, path: string): RNode[] {
    if (node === null || node === undefined || node === false || node === true) return []
    if (typeof node === 'string' || typeof node === 'number') return [{ kind: 'text', text: String(node) }]
    if (Array.isArray(node)) return node.flatMap((c, i) => this.renderInto(c, `${path}.${i}`))
    if (!React.isValidElement(node)) return []

    const el: any = node
    const type: any = el.type
    const name = typeof type === 'string' ? type : type?.displayName ?? type?.name ?? 'anon'
    const key = `${path}|${el.key ?? ''}|${name}`

    if (typeof type === 'string') {
      return [{ kind: 'host', type, props: el.props, children: this.renderInto(el.props?.children, `${key}>`) }]
    }
    if (type === React.Fragment) return this.renderInto(el.props?.children, `${key}>`)
    if (type?.$$typeof === MEMO) return this.renderInto({ ...el, type: type.type }, path)
    if (type?.$$typeof === FORWARD_REF) return this.renderInto(type.render(el.props, null), `${key}>`)
    if (typeof type === 'function') {
      const cells = this.fibers.get(key) ?? []
      this.fibers.set(key, cells)
      const prevCells = this.cells
      const prevIdx = this.idx
      this.cells = cells
      this.idx = 0
      let out: any
      try {
        out = type(el.props)
      } finally {
        this.cells = prevCells
        this.idx = prevIdx
      }
      return this.renderInto(out, `${key}>`)
    }
    return []
  }

  private renderPass() {
    this.wire()
    const prev = INTERNALS.ReactCurrentDispatcher.current
    INTERNALS.ReactCurrentDispatcher.current = this.dispatcher
    this.dirty = false
    this.passes++
    try {
      this.tree = this.renderInto(this.element, 'root')
    } finally {
      INTERNALS.ReactCurrentDispatcher.current = prev
    }
  }

  /** Render once WITHOUT running effects — the genuine first-paint state. */
  paint(): this {
    this.renderPass()
    return this
  }

  /** Run effects, apply state updates, and re-render until the tree settles. */
  async settle(): Promise<this> {
    let idle = 0
    for (let n = 0; n < 300; n++) {
      if (this.effects.length) {
        const q = this.effects
        this.effects = []
        for (const f of q) f()
        idle = 0
        continue
      }
      if (this.dirty) {
        this.renderPass()
        idle = 0
        continue
      }
      await new Promise(r => setImmediate(r))
      if (++idle >= 3) return this
    }
    throw new Error('the tree never settled — a render loop or an unresolved promise')
  }

  static async mount(element: React.ReactElement): Promise<Mounted> {
    return await new Mounted(element).paint().settle()
  }

  // ─── queries ───────────────────────────────────────────────────────────────

  hosts(from: RNode[] = this.tree, out: any[] = []): any[] {
    for (const n of from) {
      if (n.kind === 'host') {
        out.push(n)
        this.hosts(n.children, out)
      }
    }
    return out
  }

  static textOf(nodes: RNode[]): string {
    return nodes.map(n => (n.kind === 'text' ? n.text : Mounted.textOf(n.children))).join('')
  }

  text(node?: any): string {
    return Mounted.textOf(node ? node.children : this.tree)
  }

  findAll(pred: (n: any) => boolean): any[] {
    return this.hosts().filter(pred)
  }

  find(pred: (n: any) => boolean): any {
    const hit = this.findAll(pred)[0]
    return hit ?? null
  }

  /** The first host element of `type` whose rendered text contains `needle`. */
  byText(type: string, needle: string): any {
    return this.find(n => n.type === type && this.text(n).includes(needle))
  }

  /** A host element whose OWN rendered text is exactly `s` — no substring slack. */
  exactText(s: string): any {
    return this.find(n => this.text(n) === s)
  }

  button(label: string): any {
    const hit = this.byText('button', label)
    if (!hit) throw new Error(`no <button> containing ${JSON.stringify(label)}`)
    return hit
  }

  // ─── events ────────────────────────────────────────────────────────────────

  private static mouse() {
    return {
      stopPropagation() {},
      preventDefault() {},
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      button: 0,
    }
  }

  async click(node: any): Promise<this> {
    if (!node) throw new Error('click on a node that is not there')
    if (node.props?.disabled) throw new Error(`clicked a DISABLED ${node.type}`)
    if (typeof node.props?.onClick !== 'function') throw new Error(`${node.type} has no onClick`)
    node.props.onClick(Mounted.mouse())
    return await this.settle()
  }

  async setValue(node: any, value: string): Promise<this> {
    if (!node) throw new Error('change on a node that is not there')
    node.props.onChange({ target: { value }, ...Mounted.mouse() })
    return await this.settle()
  }

  async press(node: any, key: string): Promise<this> {
    if (typeof node?.props?.onKeyDown !== 'function') throw new Error(`${node?.type} has no onKeyDown`)
    node.props.onKeyDown({ key, ...Mounted.mouse() })
    return await this.settle()
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. THE SERVER, MOCKED
// ═════════════════════════════════════════════════════════════════════════════

interface Reply {
  status: number
  body: any
}
type Handler = (url: string, init: any) => Reply

let requests: Array<{ url: string; method: string; body: any }> = []
let handler: Handler

function fakeResponse(status: number, body: any): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 403 ? 'Forbidden' : status === 500 ? 'Server Error' : 'OK',
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response
}

beforeEach(() => {
  requests = []
  handler = () => ({ status: 200, body: { data: [], total: 0, has_more: false } })
  ;(global as any).fetch = jest.fn(async (url: any, init?: any) => {
    const method = init?.method ?? 'GET'
    requests.push({ url: String(url), method, body: init?.body ? JSON.parse(init.body) : null })
    return fakeResponse(...(Object.values(handler(String(url), init ?? {})) as [any, any]))
  })
})

/** Requests that were writes, in order. */
const patches = () => requests.filter(r => r.method === 'PATCH')

const SENTINEL = 'THE_BODY_BELOW_IS_A_DIFFERENT_QUERY'
const body = <p>{SENTINEL}</p>

// ═════════════════════════════════════════════════════════════════════════════
// 3. THE HARNESS PROVES ITSELF FIRST
// ═════════════════════════════════════════════════════════════════════════════
// A test harness nobody has tested is exactly the fabrication this round is
// repairing, so it is checked against behaviour whose answer is known
// independently before it is used to judge anything.

describe('the micro-renderer itself', () => {
  it('runs useState, useEffect and a click, in that order', async () => {
    const seen: string[] = []
    function Probe() {
      const [n, setN] = React.useState(0)
      React.useEffect(() => {
        seen.push('effect')
        setN(1)
      }, [])
      return (
        <div>
          <span>count {n}</span>
          <button onClick={() => setN(v => v + 10)}>bump</button>
        </div>
      )
    }
    const m = new Mounted(<Probe />).paint()
    expect(m.text()).toContain('count 0') // effects have NOT run yet
    expect(seen).toEqual([])
    await m.settle()
    expect(seen).toEqual(['effect'])
    expect(m.text()).toContain('count 1')
    await m.click(m.button('bump'))
    expect(m.text()).toContain('count 11')
  })

  it('resolves an async effect against the mocked fetch', async () => {
    handler = () => ({ status: 200, body: { hello: 'world' } })
    function Probe() {
      const [v, setV] = React.useState<string | null>(null)
      React.useEffect(() => {
        void (async () => setV((await (await fetch('/x')).json()).hello))()
      }, [])
      return <p>{v ?? 'pending'}</p>
    }
    const m = new Mounted(<Probe />).paint()
    expect(m.text()).toBe('pending')
    await m.settle()
    expect(m.text()).toBe('world')
    expect(requests.map(r => r.url)).toEqual(['/x'])
  })

  it('keeps hook state separate per component instance', async () => {
    function Counter({ start }: { start: number }) {
      const [n, setN] = React.useState(start)
      return <button onClick={() => setN(n + 1)}>n={n}</button>
    }
    const m = await Mounted.mount(
      <div>
        <Counter start={5} />
        <Counter start={50} />
      </div>,
    )
    await m.click(m.button('n=5'))
    expect(m.text()).toContain('n=6')
    expect(m.text()).toContain('n=50')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. WorkViewCard — THE COMPONENT app/page.tsx MOUNTS, NOT THE PURE VIEW
// ═════════════════════════════════════════════════════════════════════════════

const cardProps = {
  id: 'work/list',
  title: 'What is in the backlog?',
  projectFilter: 'Limiglow',
  countFilter: '&status=backlog',
  countLabel: 'in backlog',
  emptyMessage: (p: string) => `${p} has nothing in the backlog.`,
}

describe('WorkViewCard (default export, mounted)', () => {
  // KILLS MUTANT 1 — `children={undefined}` after the `{...props}` spread at
  // WorkViewCard.tsx:339. That is verbatim TOD-2444: a zero or refused count
  // deletes the whole IssuesTab. It survived round 2 at 51/51 because every
  // test rendered `WorkViewCardView` with children passed explicitly.
  it('renders its children in the in-flight state, before any count arrives', () => {
    const m = new Mounted(<WorkViewCard {...cardProps}>{body}</WorkViewCard>).paint()
    expect(m.text()).toContain(SENTINEL)
  })

  it('renders its children when the count is ZERO', async () => {
    handler = () => ({ status: 200, body: { data: [], total: 0, has_more: false } })
    const m = await Mounted.mount(<WorkViewCard {...cardProps}>{body}</WorkViewCard>)
    expect(m.text()).toContain(SENTINEL)
    // …and says so as a note ABOVE the body rather than in place of it.
    expect(m.text()).toContain("No rows in Limiglow match this card's count")
    expect(m.text()).not.toContain('Limiglow has nothing in the backlog.')
  })

  it('renders its children when the count query is REFUSED', async () => {
    handler = () => ({ status: 403, body: { error: 'project scope denied' } })
    const m = await Mounted.mount(<WorkViewCard {...cardProps}>{body}</WorkViewCard>)
    expect(m.text()).toContain(SENTINEL)
  })

  it('renders its children when no project is resolved yet', () => {
    const m = new Mounted(
      <WorkViewCard {...cardProps} projectFilter={null}>
        {body}
      </WorkViewCard>,
    ).paint()
    expect(m.text()).toContain(SENTINEL)
  })

  // KILLS MUTANT 2 — `setError(result.error)` -> `setError(null)` at :329.
  it('shows the error banner when the count is refused', async () => {
    handler = () => ({ status: 403, body: { error: 'project scope denied' } })
    const m = await Mounted.mount(<WorkViewCard {...cardProps}>{body}</WorkViewCard>)
    const banner = m.find(n => n.props?.['data-testid'] === 'api-error-banner')
    expect(banner).toBeTruthy()
    expect(m.text(banner)).toContain('data unavailable — 403 from /api/issues: project scope denied')
  })

  // KILLS MUTANT 3 — `setLoaded(true)` -> `setLoaded(false)` at :331. With
  // loaded false the metric is omitted forever and the card sits in its
  // in-flight state; nothing else on the card changes, which is why round 2's
  // suite could not see it.
  it('shows the metric once the count resolves', async () => {
    handler = () => ({ status: 200, body: { data: [{ id: 'a' }], total: 7, has_more: true } })
    const m = await Mounted.mount(<WorkViewCard {...cardProps}>{body}</WorkViewCard>)
    expect(m.text()).toContain('7 in backlog')
  })

  it('singularises the metric noun at a count of exactly 1, in the mounted card', async () => {
    handler = () => ({ status: 200, body: { data: [{ id: 'a' }], total: 1, has_more: false } })
    const m = await Mounted.mount(
      <WorkViewCard {...cardProps} countLabel="epics">
        {body}
      </WorkViewCard>,
    )
    expect(m.text()).toContain('1 epic')
    expect(m.text()).not.toContain('1 epics')
  })

  // KILLS MUTANT 4 — `source={query ?? '…'}` -> `source={""}` at :339. The
  // printed provenance vanishes while `emptyNoteAboveBody` keeps saying "the
  // query is printed above".
  it('prints the exact query it counted, and counts the query it printed', async () => {
    handler = () => ({ status: 200, body: { data: [], total: 0, has_more: false } })
    const m = await Mounted.mount(<WorkViewCard {...cardProps}>{body}</WorkViewCard>)
    const query = '/api/issues?project=Limiglow&limit=1&status=backlog'
    expect(m.text()).toContain(query)
    expect(requests.map(r => r.url)).toEqual([query])
  })

  it('re-issues the count when Retry is pressed on the banner', async () => {
    handler = () => ({ status: 500, body: { error: 'boom' } })
    const m = await Mounted.mount(<WorkViewCard {...cardProps}>{body}</WorkViewCard>)
    expect(requests).toHaveLength(1)
    handler = () => ({ status: 200, body: { data: [{ id: 'a' }], total: 3, has_more: false } })
    await m.click(m.button('Retry'))
    expect(requests).toHaveLength(2)
    expect(m.text()).toContain('3 in backlog')
    expect(m.find(n => n.props?.['data-testid'] === 'api-error-banner')).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. IssuesTab — MOUNTED, LOADED, AND OPERATED
// ═════════════════════════════════════════════════════════════════════════════

const ROWS = [
  { id: 'i1', task_key: 'TOD-9001', title: 'Alpha task', status: 'backlog', priority: 'high', type: 'task', assignee: 'builder', sprint: 'S1' },
  { id: 'i2', task_key: 'TOD-9002', title: 'Beta task', status: 'open', priority: 'low', type: 'task', assignee: 'builder', sprint: 'S1' },
]

const LIST_ENDPOINT = '/api/issues?project=Limiglow&limit=0'

/** GET the issue list / the agent roster; every PATCH is delegated to `onPatch`. */
function serve(rows: any[], onPatch: (b: any) => Reply = () => ({ status: 200, body: {} })): Handler {
  return (url, init) => {
    if ((init?.method ?? 'GET') === 'PATCH') return onPatch(JSON.parse(init.body))
    if (url.startsWith('/api/agents')) return { status: 200, body: { agents: [], rosterSource: 'none' } }
    return { status: 200, body: { data: rows, total: rows.length, has_more: false } }
  }
}

async function mountTab(h: Handler) {
  handler = h
  return await Mounted.mount(<IssuesTab projectFilter="Limiglow" />)
}

/** The desktop row for an issue — a div carrying handleExpand. */
function rowFor(m: Mounted, title: string) {
  return m.find(n => n.type === 'div' && typeof n.props?.onClick === 'function' && m.text(n).includes(title))
}

describe('IssuesTab (default export, mounted)', () => {
  // KILLS MUTANT 9 — `countLabelFor(trueTotal, 'issues')` -> `'issues'` at
  // :379. This is the piece's ORIGINAL headline defect, "1 issues", restored
  // in the header. `countLabelFor` was unit-tested; its USE here was not.
  it('agrees with itself in the header at a count of exactly 1', async () => {
    const m = await mountTab(serve([ROWS[0]]))
    expect(m.text()).toContain('1 issue')
    expect(m.text()).not.toContain('1 issues')
  })

  it('pluralises the header at a count of 2', async () => {
    const m = await mountTab(serve(ROWS))
    expect(m.text()).toContain('2 issues')
  })

  // KILLS MUTANT 15 — deleting the printed endpoint line at :391.
  it('prints the endpoint it actually requested', async () => {
    const m = await mountTab(serve(ROWS))
    expect(m.text()).toContain(LIST_ENDPOINT)
    expect(requests.map(r => r.url)).toContain(LIST_ENDPOINT)
  })

  // KILLS MUTANT 10 — `countVerbFor(loadedTotal,'are','is')` -> `'are'` at
  // :594. Round 2's OWN headline defect, "1 issue are loaded", restored.
  // KILLS MUTANT 12 — collapsing the empty-state titles to 'No issues found'.
  it('says "1 issue is loaded" — noun AND verb — when a search matches nothing', async () => {
    const m = await mountTab(serve([ROWS[0]]))
    const search = m.find(n => n.type === 'input')
    await m.setValue(search, 'zzzz-no-match')
    expect(m.text()).toContain('1 issue is loaded')
    expect(m.text()).not.toContain('1 issue are loaded')
    expect(m.text()).not.toContain('1 issues are loaded')
    expect(m.text()).toContain('Nothing in Limiglow matches “zzzz-no-match”')
    expect(m.text()).not.toContain('No issues found')
  })

  it('names the project, not the search, when the project itself is empty', async () => {
    const m = await mountTab(serve([]))
    expect(m.text()).toContain('Limiglow has no issues yet')
    expect(m.text()).toContain('That is correct, not broken.')
    expect(m.text()).not.toContain('No issues found')
  })

  // MUTANT 11, re-measured. The critic reported that dropping `!fetchError`
  // from the empty-state guard at :575 lets an empty state render over a failed
  // request. It does NOT — see §"equivalent mutant" in the piece doc: that
  // guard is nested inside `{!loading && !fetchError && (` at :440, so it is
  // redundant and the mutation is unobservable. The behaviour the critic was
  // actually reaching for is the one pinned here, which holds whichever guard
  // carries it.
  it('renders the error banner and NO empty state when the load fails', async () => {
    const m = await mountTab(() => ({ status: 500, body: { error: 'db is down' } }))
    expect(m.text()).toContain('data unavailable — 500 from /api/issues')
    expect(m.text()).toContain('data unavailable') // the header count, too
    expect(m.text()).not.toContain('has no issues yet')
    expect(m.text()).not.toContain('No issues found')
  })

  // KILLS MUTANT 5 — `{writeError && (` -> `{false && writeError && (` at :406.
  // A rejected PATCH renders nothing on screen. The round-2 source guard's
  // exact string is untouched by that edit, which is why it survived.
  // KILLS MUTANT 7 — `if (error) {` -> `if (false && error) {` at :288, which
  // closes the editor AND splices `row!` (null) into the list.
  it('shows a banner and KEEPS THE EDITOR OPEN when a save is refused', async () => {
    const m = await mountTab(
      serve(ROWS, () => ({ status: 400, body: { error: 'regression_test is required' } })),
    )
    await m.click(rowFor(m, 'Alpha task'))
    expect(m.button('Save')).toBeTruthy()

    await m.click(m.button('Save'))

    expect(patches()).toHaveLength(1)
    const banner = m.find(n => n.props?.['data-testid'] === 'api-error-banner')
    expect(banner).toBeTruthy()
    expect(m.text(banner)).toContain('400 from PATCH /api/issues: regression_test is required')
    // the editor is still open…
    expect(m.byText('button', 'Save')).toBeTruthy()
    // …and the row on screen was not replaced by the null the server refused
    expect(m.text()).toContain('Alpha task')
    expect(m.text()).toContain('Beta task')
  })

  // KILLS MUTANT 6 — `const retryFailedWrite = () => { return` at :342, which
  // makes the banner's Retry button a no-op with the guarded string intact.
  it('re-sends the save — with the CURRENT edits — when Retry is pressed', async () => {
    let refuse = true
    const m = await mountTab(
      serve(ROWS, b =>
        refuse
          ? { status: 400, body: { error: 'regression_test is required' } }
          : { status: 200, body: { ...ROWS[0], ...b } },
      ),
    )
    await m.click(rowFor(m, 'Alpha task'))
    await m.click(m.button('Save'))
    expect(patches()).toHaveLength(1)

    // The operator corrects the Status select, THEN presses Retry. Round 2's
    // own comment says this must send the corrected payload, not the stale one.
    const statusSelect = m.find(n => n.type === 'select' && n.props?.value === 'backlog')
    await m.setValue(statusSelect, 'in_progress')
    refuse = false
    await m.click(m.button('Retry'))

    expect(patches()).toHaveLength(2)
    expect(patches()[0].body.status).toBe('backlog')
    expect(patches()[1].body).toMatchObject({ id: 'i1', status: 'in_progress' })
  })

  // KILLS MUTANT 13 (save half) — deleting the optimistic `setIssues(...)` at
  // :294. A write the server ACCEPTED leaves a stale row on screen.
  it('shows the accepted row immediately after a successful save', async () => {
    const m = await mountTab(
      serve(ROWS, b => ({ status: 200, body: { ...ROWS[0], ...b, title: 'Alpha task (server-renamed)' } })),
    )
    await m.click(rowFor(m, 'Alpha task'))
    await m.click(m.button('Save'))
    expect(m.text()).toContain('Alpha task (server-renamed)')
    // the editor closed, and no banner
    expect(m.find(n => n.type === 'button' && m.text(n) === 'Save')).toBeNull()
    expect(m.find(n => n.props?.['data-testid'] === 'api-error-banner')).toBeNull()
  })

  // KILLS MUTANT 8 — inserting `setWriteError(null)` after
  // `setWriteError(outcome.error)` at :333. Partial bulk failures go silent
  // again while every source guard still matches.
  it('names the refused rows by task key after a PARTIAL bulk failure', async () => {
    const m = await mountTab(
      serve(ROWS, b =>
        b.id === 'i2'
          ? { status: 400, body: { error: 'regression_test is required' } }
          : { status: 200, body: { ...ROWS[0], ...b } },
      ),
    )
    await m.click(m.button('✓')) // select-all in the table header
    expect(m.text()).toContain('2 selected')
    await m.setValue(
      m.find(n => n.type === 'select' && n.props?.value === ''),
      'code_review',
    )
    await m.click(m.button('Apply'))

    const banner = m.find(n => n.props?.['data-testid'] === 'api-error-banner')
    expect(banner).toBeTruthy()
    const said = m.text(banner)
    expect(said).toContain('1 of 2 could not move to "code review"')
    expect(said).toContain('TOD-9002')
    // ROUND 3: this assertion is what found `only those row` in the shipped
    // sentence — round 2 asserted the retry BEHAVIOUR and never read the words.
    expect(said).toContain('Retry re-sends only that row.')
    expect(said).not.toContain('those row')
    // the failed row stays selected and the target status is retained
    expect(m.text()).toContain('1 selected')
  })

  // KILLS MUTANT 14 — `retryFailedWrite` always calling `handleSave()`
  // regardless of `writeIntent`: Retry after a failed bulk would re-send the
  // wrong request entirely (and, with no row expanded, send nothing at all).
  it('re-sends ONLY the refused rows when Retry follows a bulk failure', async () => {
    let failing = 'i2'
    const m = await mountTab(
      serve(ROWS, b =>
        b.id === failing
          ? { status: 400, body: { error: 'regression_test is required' } }
          : { status: 200, body: { id: b.id, ...ROWS.find(r => r.id === b.id), ...b } },
      ),
    )
    await m.click(m.button('✓'))
    await m.setValue(m.find(n => n.type === 'select' && n.props?.value === ''), 'code_review')
    await m.click(m.button('Apply'))
    expect(patches()).toHaveLength(2)

    failing = 'none'
    await m.click(m.button('Retry'))

    const after = patches().slice(2)
    expect(after.map(p => p.body.id)).toEqual(['i2'])
    expect(after[0].body.status).toBe('code_review')
    expect(m.find(n => n.props?.['data-testid'] === 'api-error-banner')).toBeNull()
  })

  // KILLS MUTANT 13 (bulk half) — deleting the optimistic `setIssues(...)` at
  // :330.
  it('shows the accepted rows immediately after a successful bulk move', async () => {
    const m = await mountTab(
      serve(ROWS, b => ({ status: 200, body: { ...ROWS.find(r => r.id === b.id), ...b, title: `moved ${b.id}` } })),
    )
    await m.click(m.button('✓'))
    await m.setValue(m.find(n => n.type === 'select' && n.props?.value === ''), 'code_review')
    await m.click(m.button('Apply'))
    expect(m.text()).toContain('moved i1')
    expect(m.text()).toContain('moved i2')
    // a clean bulk clears the bar rather than leaving it implying work outstanding
    expect(m.text()).not.toContain('selected')
  })

  it('every issue key on the list is a real anchor with a real href', async () => {
    const m = await mountTab(serve(ROWS))
    const anchors = m.findAll(n => n.type === 'a')
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) expect(String(a.props.href)).toContain('/i/')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. FeatureCard — THE VISIBLE STRING, NOT A SUBSTRING OF THE WHOLE PAGE
// ═════════════════════════════════════════════════════════════════════════════

const feature = (children: any[]) => ({
  id: 'f1',
  task_key: 'TOD-9100',
  title: 'A feature',
  status: 'open',
  project: 'Limiglow',
  children,
})

// `done` is counted from `status_category`, not `status` — see
// components/tabs/FeatureCard.tsx:82. Getting that wrong in a fixture is how a
// progress assertion quietly measures nothing, so the fixture states both.
const child = (i: number, category: 'Done' | 'InProgress') => ({
  id: `c${i}`,
  task_key: `TOD-91${i}`,
  title: `child ${i}`,
  status: category === 'Done' ? 'completed' : 'open',
  status_category: category,
})

describe('FeatureCard progress', () => {
  // KILLS MUTANT 16 — `${done}/${total} done` -> `${done}/${total}` at :153.
  // It survived round 2 because the assertion was
  // `expect(html).toContain('done')` and `aria-valuetext` still contains the
  // word — a toothless substring over the whole document. The assertion here
  // is on the EXACT text of the one element the sighted reader sees.
  it('the visible ratio carries its noun', () => {
    const kids = [child(1, 'Done'), child(2, 'Done'), child(3, 'InProgress'), child(4, 'InProgress'), child(5, 'InProgress')]
    const m = new Mounted(<FeatureCard feature={feature(kids) as any} expanded={false} onToggle={() => {}} />).paint()
    expect(m.exactText('2/5 done')).toBeTruthy()
  })

  it('says there is nothing to measure rather than rendering a 0/0 widget', () => {
    const m = new Mounted(<FeatureCard feature={feature([]) as any} expanded={false} onToggle={() => {}} />).paint()
    expect(m.exactText('no child issues')).toBeTruthy()
    expect(m.find(n => n.props?.role === 'progressbar')).toBeNull()
  })

  it('carries a well-formed progressbar when there IS progress', () => {
    const m = new Mounted(<FeatureCard
        feature={feature([child(1, 'Done'), child(2, 'InProgress')]) as any}
        expanded={false}
        onToggle={() => {}}
      />).paint()
    const bar = m.find(n => n.props?.role === 'progressbar')
    expect(bar.props['aria-valuemax']).toBe(2)
    expect(bar.props['aria-valuenow']).toBe(1)
    expect(bar.props['aria-valuemax']).toBeGreaterThan(bar.props['aria-valuemin'])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. KanbanCard — THE CARD THE DEFAULT BOARD RENDERS
// ═════════════════════════════════════════════════════════════════════════════

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    task_key: 'TOD-368',
    title: 'A card on the board',
    status: 'in_progress',
    type: 'task',
    priority: 'high',
    assignee: 'builder',
    ...over,
  }) as Task

describe('KanbanCard', () => {
  // The critic measured a REAL Limiglow row on the running server carrying
  // `blocked_by: "system:ceiling_stop:no_progress"` — 31 characters — rendered
  // untruncated inside a kanban column, while the file's own `truncate()` was
  // applied to the title only. The comment above that JSX claimed the value
  // "fits in eight characters". Both are repaired; this pins the repair.
  it('truncates a long blocker in the chip and keeps it whole for assistive tech', () => {
    const t = task({ blocked_by: 'system:ceiling_stop:no_progress' } as any)
    const m = new Mounted(<KanbanCard task={t} now={Date.parse('2026-08-26T20:00:00Z')} />).paint()

    const chip = m.find(n => n.props?.['aria-hidden'] === 'true' && m.text(n).includes('system:'))
    expect(chip).toBeTruthy()
    expect(m.text(chip).length).toBeLessThanOrEqual(20)
    expect(m.text(chip).endsWith('…')).toBe(true)

    const srOnly = m.find(n => n.props?.className === 'sr-only' && m.text(n).includes('blocked by'))
    expect(m.text(srOnly)).toBe('blocked by system:ceiling_stop:no_progress')
    const wrapper = m.find(n => typeof n.props?.title === 'string' && n.props.title.startsWith('blocked by'))
    expect(wrapper.props.title).toBe('blocked by system:ceiling_stop:no_progress')
  })

  it('leaves a short blocker alone', () => {
    const m = new Mounted(<KanbanCard task={task({ blocked_by: 'TOD-12' } as any)} />).paint()
    const chip = m.find(n => n.props?.['aria-hidden'] === 'true' && m.text(n).includes('TOD-12'))
    expect(m.text(chip)).toBe('TOD-12')
  })

  // The critic's Linear gap (2): the card's root was `<div draggable onClick>`
  // with no role and no tabIndex, so a keyboard user could not open a card at
  // all — a lane had spent a round adding sr-only labels to a click target no
  // assistive-tech user could reach. NOT proven here: that the element is
  // reachable by Tab in a real browser, or that a screen reader announces it.
  // There is no browser in this lane. What IS proven: the props are emitted and
  // the key handler invokes the same callback the click does.
  it('opens from the keyboard, not only from a mouse', async () => {
    const opened: string[] = []
    const t = task()
    const m = new Mounted(<KanbanCard task={t} onClick={x => opened.push(x.id)} />).paint()

    const root = m.tree[0] as any
    expect(root.props.role).toBe('button')
    expect(root.props.tabIndex).toBe(0)
    expect(String(root.props['aria-label'])).toContain('TOD-368')

    await m.press(root, 'Enter')
    await m.press(root, ' ')
    expect(opened).toEqual(['t1', 't1'])

    await m.press(root, 'a')
    expect(opened).toHaveLength(2)
  })

  it('still says how long the work has been sitting', () => {
    const t = task({ started_at: '2026-08-26T19:00:00.000Z' } as any)
    const m = new Mounted(<KanbanCard task={t} now={Date.parse('2026-08-26T20:00:00Z')} />).paint()
    expect(m.text()).toContain('started 1h ago')
    expect(m.text()).toContain('work started 1h ago')
  })
})

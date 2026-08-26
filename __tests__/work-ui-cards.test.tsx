// __tests__/work-ui-cards.test.tsx — Work Management UI, cards lane.
//
// WHAT THIS CAN AND CANNOT PROVE
// ------------------------------
// This repo's jest runs `testEnvironment: "node"` and has no @testing-library,
// so there is no jsdom and no click. What there IS, is React's own server
// renderer, which produces the real markup these components emit for a given
// prop set. Every assertion below is made against that STRING — not against a
// description of what the component is supposed to do.
//
// So: markup is proven, interaction is not. Nothing here claims a browser was
// involved, and the collapse-persistence and drag behaviours are explicitly out
// of reach from this file (Card's collapse reads localStorage in useEffect,
// which does not run under renderToStaticMarkup). Those are named in the piece
// doc as unverified-by-me.

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { KanbanCard } from '@/components/KanbanCard'
import FeatureCard from '@/components/tabs/FeatureCard'
import { countLabelFor, singularizeLabel, emptyStatePlacement } from '@/components/tabs/WorkViewCard'
import type { Task } from '@/lib/issues'

const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', title: 'A task', status: 'open', ...over }) as Task

// ─── the "1 issues" defect ───────────────────────────────────────────────────
//
// MEASURED against the running dev server's database on 2026-08-26: project
// Limiglow holds 2 issues, exactly ONE of which is type='epic'. app/page.tsx
// mounts the Epics card with countLabel="epics", so at that real count the
// operator read "1 epics". These pin the rule that fixed it, INCLUDING the
// labels that must NOT be touched — a pluraliser that mangles "in backlog" into
// "in backlo" would be a worse bug than the one it replaced.
describe('count labels agree with the number they sit beside', () => {
  it('singularises at exactly 1 and only at 1', () => {
    expect(countLabelFor(0, 'issues')).toBe('issues')
    expect(countLabelFor(1, 'issues')).toBe('issue')
    expect(countLabelFor(2, 'issues')).toBe('issues')
    expect(countLabelFor(1, 'epics')).toBe('epic')
  })

  it('leaves alone the labels app/page.tsx passes that are not "s" plurals', () => {
    // These two are the live callers: countFilter="&status=backlog" and
    // countFilter="&has_due=1". Both read correctly at 1 already.
    expect(countLabelFor(1, 'in backlog')).toBe('in backlog')
    expect(countLabelFor(1, 'with a due date')).toBe('with a due date')
  })

  it('refuses the "in progres" class of mistake', () => {
    expect(singularizeLabel('in progress')).toBe('in progress')
    expect(singularizeLabel('blockers pass')).toBe('blockers pass')
  })

  it('honours an explicit singular over the guess', () => {
    expect(countLabelFor(1, 'people', 'person')).toBe('person')
    expect(countLabelFor(3, 'people', 'person')).toBe('people')
  })
})

// ─── a count may never delete a body ─────────────────────────────────────────
//
// The live shape this protects: app/page.tsx mounts `work/list` as a
// WorkViewCard whose count query carries `&status=backlog`, wrapping an
// IssuesTab that lists EVERY issue in the project. The two scopes are different
// on purpose. Before this rule, a project with an empty backlog and a full
// table rendered the backlog's empty sentence IN PLACE OF the table.
describe('emptyStatePlacement — a zero count never blanks a body', () => {
  it('says nothing before the count has loaded', () => {
    expect(emptyStatePlacement(false, null, true)).toBe('none')
    expect(emptyStatePlacement(false, null, false)).toBe('none')
  })

  it('says nothing when the count is not zero', () => {
    expect(emptyStatePlacement(true, 1, true)).toBe('none')
    expect(emptyStatePlacement(true, 4000, false)).toBe('none')
  })

  it('takes over the body only when the card HAS no body', () => {
    // The header-only callers (work/epics, work/bolt) — the sentence is the
    // whole point of the card there.
    expect(emptyStatePlacement(true, 0, false)).toBe('replaces-body')
  })

  it('demotes itself to a note when a body exists', () => {
    // work/list and work/board. The body renders either way.
    expect(emptyStatePlacement(true, 0, true)).toBe('note-above-body')
    expect(emptyStatePlacement(true, 0, true)).not.toBe('replaces-body')
  })
})

// ─── the board says what work is stuck ON ────────────────────────────────────
describe('KanbanCard — the card the default board actually renders', () => {
  it('names the blocker rather than showing an unlabelled padlock', () => {
    const html = renderToStaticMarkup(<KanbanCard task={task({ blocked_by: 'TOD-999' })} />)
    expect(html).toContain('TOD-999')

    // ROUND 2. This assertion used to be a bare
    // `expect(html).toContain('blocked by TOD-999')`, and the critic proved it
    // toothless: deleting the sr-only span outright still passed, because the
    // sibling `title="blocked by TOD-999"` attribute satisfied the substring on
    // its own. A `title` is not an accessible name a screen reader can be
    // relied on to announce, and the accessible name was the whole point of the
    // change. So the assertion is now on the sr-only element itself.
    expect(html).toMatch(/<span class="sr-only">blocked by TOD-999<\/span>/)

    // And the visible key is hidden from AT so the name is not announced twice.
    expect(html).toMatch(/<span aria-hidden="true">TOD-999<\/span>/)
  })

  it('the padlock glyph itself is decorative, not an unlabelled control', () => {
    const html = renderToStaticMarkup(<KanbanCard task={task({ blocked_by: 'TOD-999' })} />)
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
  })

  it('still says "blocked" when the flag is set but no blocker is named', () => {
    const html = renderToStaticMarkup(<KanbanCard task={task({ is_blocked: true })} />)
    expect(html).toMatch(/<span class="sr-only">blocked<\/span>/)
    // No fabricated blocker id when the row does not carry one.
    expect(html).not.toContain('blocked by')
  })

  it('renders no blocked affordance at all for an unblocked task', () => {
    const html = renderToStaticMarkup(<KanbanCard task={task()} />)
    expect(html).not.toContain('blocked')
  })

  it('renders the issue key as a real anchor, not a span', () => {
    // TOD-2463's regression: the key rendered as a SPAN on the board and
    // `a[href*="/i/"]` counted zero. This is the file that fixed it.
    const html = renderToStaticMarkup(<KanbanCard task={task({ task_key: 'TOD-200' })} />)
    expect(html).toMatch(/<a [^>]*href="[^"]*\/i\/TOD-200"/)
  })
})

// ─── the feature card's one metric is legible to more than one sense ─────────
describe('FeatureCard', () => {
  const feature = (over: Record<string, unknown> = {}) =>
    ({
      id: 'f1',
      title: 'Checkout rebuild',
      status: 'open',
      task_key: 'TOD-201',
      children: [],
      ...over,
    }) as any

  it('exposes progress as a progressbar with real values, not two bare divs', () => {
    const html = renderToStaticMarkup(
      <FeatureCard
        feature={feature({
          children: [
            { id: 'a', title: 'one', status: 'completed', status_category: 'Done' },
            { id: 'b', title: 'two', status: 'open', status_category: 'Planned' },
          ],
        })}
        expanded={false}
        onToggle={() => {}}
      />
    )
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="1"')
    expect(html).toContain('aria-valuemax="2"')
    expect(html).toContain('1 of 2 child issues done')
    // The visible ratio carries its noun instead of being a bare "1/2".
    expect(html).toContain('done')
  })

  // ROUND 2, the critic's third live defect: with zero children the bar
  // rendered role="progressbar" aria-valuemin="0" aria-valuemax="0"
  // aria-valuenow="0". aria-valuemax must exceed aria-valuemin, so that is a
  // malformed widget, and no test covered the zero-children shape at all.
  it('renders no progressbar at all for a feature with no children', () => {
    const html = renderToStaticMarkup(
      <FeatureCard feature={feature()} expanded={false} onToggle={() => {}} />
    )
    expect(html).not.toContain('role="progressbar"')
    expect(html).not.toContain('aria-valuemax="0"')
    // The bar is decoration in that state, and the text says the fact rather
    // than the meaningless ratio "0/0 done".
    expect(html).not.toContain('0/0')
    expect(html).toContain('no child issues')
  })

  it('names the feature in its empty state instead of "No child issues"', () => {
    const html = renderToStaticMarkup(
      <FeatureCard feature={feature()} expanded onToggle={() => {}} />
    )
    expect(html).toContain('TOD-201')
    expect(html).toContain('no child issues yet')
    expect(html).toContain('correct, not broken')
    expect(html).not.toContain('>No child issues<')
  })

  it('omits the project chip entirely when the row carries no project', () => {
    const withOut = renderToStaticMarkup(
      <FeatureCard feature={feature()} expanded={false} onToggle={() => {}} />
    )
    const withIt = renderToStaticMarkup(
      <FeatureCard feature={feature({ project: 'Limiglow' })} expanded={false} onToggle={() => {}} />
    )
    expect(withIt).toContain('Limiglow')
    // The chip's inline border style is the chip's fingerprint; absent means
    // absent, not an empty pill.
    expect(withOut).not.toContain('border:1px solid')
  })
})

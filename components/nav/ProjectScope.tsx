'use client'
// components/nav/ProjectScope.tsx — scope-is-a-boundary piece
//
// ONE scope source. Before this, every destination in app/page.tsx read the
// same `selectedProject` state variable and re-typed it as a same-named
// `projectFilter` prop at roughly a dozen independent JSX call sites —
// correct today only because every call site happened to type the same
// variable name. This Context makes "one scope source" a structural
// guarantee instead of a typing convention: there is exactly one Provider,
// mounted once in app/page.tsx around the whole destination tree, and every
// consumer in the render reads the SAME value from it in the SAME render. A
// new consumer cannot be handed a different, stale, or mistyped scope by a
// parent that meant to forward the right one and didn't.
//
// components/tabs/** is owned by another agent working concurrently on this
// repo (see the piece's DO NOT TOUCH list) and still takes scope as a
// `projectFilter` prop rather than reading this context directly — that is a
// real, recorded gap. Full compliance with "a tab should not receive scope as
// an argument at all" requires editing tab internals, which is out of bounds
// for this piece. What this file DOES deliver: every scope-aware node this
// piece owns (DestinationShell, and app/page.tsx's own render) is wired to
// this single Provider, so the tabs' prop-drill now has one provably-single
// origin instead of N places that happen to agree.

import React, { createContext, useContext } from 'react'

export interface ProjectScopeValue {
  /** Real project name (e.g. "Limiglow"), or null when nothing is scoped yet. */
  readonly project: string | null
}

const Ctx = createContext<ProjectScopeValue | null>(null)

export function ProjectScopeProvider({
  project,
  children,
}: {
  project: string | null
  children: React.ReactNode
}) {
  return <Ctx.Provider value={{ project }}>{children}</Ctx.Provider>
}

/**
 * Reads the current project scope. Throws outside a Provider — a missing
 * Provider is a wiring bug in this file's owner (app/page.tsx), and must
 * surface as a crash during development, not silently read as "no project".
 */
export function useProjectScope(): ProjectScopeValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useProjectScope() called outside <ProjectScopeProvider> — see app/page.tsx')
  }
  return ctx
}

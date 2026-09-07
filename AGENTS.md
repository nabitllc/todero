# AGENTS.md

Guidance for human and AI contributors working in this repository.

This file is an entry point, not a rulebook. It gives the purpose, the read order, and one line per
topic that names where the rule lives. Each rule is written out in full at the target it names.

## 1. Purpose

Todero is a control plane for AI-agent companies.
The current implementation target is V1 and is defined in `doc/SPEC-implementation.md`.

## 2. Read This First

Before making changes, read in this order:

1. `doc/GOAL.md`
2. `doc/PRODUCT.md`
3. `doc/SPEC-implementation.md`
4. `doc/DEVELOPING.md`
5. `doc/DATABASE.md`

`doc/SPEC.md` is long-horizon product context.
`doc/SPEC-implementation.md` is the concrete V1 build contract.

Then read `docs/ai_context/`. That folder is the project layer for every contributor and every AI
runtime: the stack, the real commands, the schema invariants, the design intent, and the decision
log. `CONTRIBUTING.md` is the contribution process.

## 3. Where each rule lives

| Topic | Read |
|---|---|
| Repo map — what each workspace holds | `docs/ai_context/architecture.md` § Repo map |
| Stack, entry points, dev setup, ports, health check | `docs/ai_context/architecture.md` |
| Keep contracts synchronized across `packages/db`, `packages/shared`, `server` and `ui` | `docs/ai_context/architecture.md` § Contract synchronization |
| Control-plane invariants: company scope, single assignee, atomic checkout, approval gates, budget hard stop, activity log | `docs/ai_context/data_model.md` § Invariants |
| Database change workflow | `docs/ai_context/data_model.md` § Changing the schema |
| Telemetry, observability and the run log — three paths, three review levels | `docs/ai_context/data_model.md` § The three data paths |
| API and auth expectations for new endpoints | `docs/ai_context/decisions.md` § ADR-003 |
| Verification before hand-off, and the definition of done | `docs/ai_context/session_gates.md` |
| Per-file size limits | `docs/ai_context/file_size_limits.md` |
| UI expectations | `docs/ai_context/ui_standards.md` § Working rules |
| Write surfaces: plan documents, generated artifacts, strategic docs | `docs/ai_context/README.md` § Write surfaces |
| Architectural decisions — and the log you append to | `docs/ai_context/decisions.md` |
| Pull requests, branch names, issue links, review bar | `CONTRIBUTING.md` |
| Apps catalog connections | `doc/connections/CONNECTOR-PLAYBOOK.md` |

## 4. Design system

`DESIGN.md` at the repo root is the source of truth for UI design decisions. The token-only rule
applies to all `ui/` changes: every color, spacing, radius, type, shadow and motion value in
`ui/src/components/**` and `ui/src/pages/**` comes from the token layer in `ui/src/index.css` — no
hex, raw px, arbitrary Tailwind bracket values, or raw `font-size`/`fontSize` declarations outside
the documented allowlist in `ui/src/index.css`. Run `pnpm check:token-gates`
(`scripts/check-token-gates.mjs`) before you commit a UI change.

Design intent and the working rules for UI changes: `docs/ai_context/ui_standards.md`.

## 5. Pull requests

Read and fill in every section of [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).
Do not write an ad hoc PR body. `CONTRIBUTING.md` gives the rules and worked examples.

A change is done when it meets `docs/ai_context/session_gates.md` § Definition of done.

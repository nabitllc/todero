# docs/ai_context

The AI-facing project layer for Todero. Added 2026-09-06 (see `decisions.md`, ADR-009).

## The three layers

| Layer | Holds | Where |
|---|---|---|
| **Vault** | Universal, cross-project: identity, communication style, operating model, playbooks, agents, skills. Read-only to AI. | `C:\Development\Mich-Brain2\BOOTSTRAP.md`; cloud sessions clone `github.com/michsaenz/Mich-Brain2` |
| **Project** | What only Todero knows: its stack, its real gates, its schema invariants, its design intent, its decision log. | this folder |
| **Runtime entry** | The pointers a runtime eagerly loads. Both are pointer-only. | `CLAUDE.md` (Claude Code), `AGENTS.md` (runtime-neutral entry point) |

The vault holds the standard; this folder holds the specifics. Without the middle layer a session
inherits principles and zero project facts, which is the state that produces generic work.

Deep reference lives one layer further out, in `doc/` (operational and product docs) and `docs/`
(the published Mintlify site).

## Files

| File | What it holds |
|---|---|
| `architecture.md` | Stack, workspaces, entry points, how it runs, the three-repo map, pointers to `doc/` |
| `session_gates.md` | The real check / typecheck / test / build commands, what CI actually gates, and which gates do not run on Windows |
| `file_size_limits.md` | Per-file thresholds (inherited from the vault; the repo documents none) |
| `data_model.md` | Postgres + Drizzle invariants, the schema change workflow, the three data paths |
| `ui_standards.md` | Design intent; defers to `DESIGN.md` and fills only the brand gap it leaves open |
| `decisions.md` | **Append-only ADR log — the shared memory across sessions and runtimes** |

## Write surfaces

- **`decisions.md` is append-only and AI-writable.** Append an ADR whenever a session makes a
  meaningful technical or architectural choice. Never edit a prior entry — supersede it.
- **Every other file here is curated.** Propose a diff; do not edit in place. New subfolders follow
  the same rule.
- Code and tests under `server/`, `ui/`, `cli/`, `packages/` are write-allowed per the normal
  contribution rules in `CONTRIBUTING.md`.
- **The vault is never written by an AI session.** Propose vault changes as diffs; only its
  `_pending/` is AI-writable.

If this file and `CLAUDE.md` ever disagree about write surfaces, the narrower list wins.

The three rules below moved here from `AGENTS.md` § 5.4, § 5.5 and § 5.6 on 2026-09-06 (ADR-010).

### Strategic docs

Do not replace strategic docs wholesale unless you are asked to. Prefer additive updates. Keep
`doc/SPEC.md` and `doc/SPEC-implementation.md` aligned with each other.

### Plan documents

Keep repo plan docs dated and centralized. When you create a plan file in the repository itself, put
it in `doc/plans/` with a `YYYY-MM-DD-slug.md` filename.

This does not replace Todero issue planning. If a Todero issue asks for a plan, update the issue
`plan` document per the `todero` skill instead of creating a repo markdown file.

### Generated artifacts

Attach inspectable generated artifacts. When your task produces a user-inspectable deliverable file,
follow the Todero skill's "Generated Artifacts and Work Products" workflow before final disposition.

In this repo, prefer the self-contained skill helper at
`skills/todero/scripts/todero-upload-artifact.sh` so the file is available through the Todero API.
Create or update an artifact work product when the file is the deliverable, link the uploaded
artifact in the final issue comment, and then set status. Do not rely on local filesystem paths as
the only access path.

If an important file intentionally remains workspace-only, create or update a work product with
`metadata.resourceRef.kind: "workspace_file"` and a workspace-relative path, then name that work
product and path in the final comment. Treat browse and search as a fallback for recovering
workspace files, not the preferred deliverable path. See `doc/AGENT-ARTIFACTS.md` for details and
`.mp4` / `.webm` examples.

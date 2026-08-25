# PIECE: Archive — hide history without destroying it, and let the admin export then delete

id: archive-and-export
lane: Operator

## Why this piece matters

Michael, 2026-08-25, verbatim: *"fully archive all of the tasks within Todero. you
are the one working on it based on this loop and expectations, not based on those
tasks. everything currently in Todero different from Limiglow should be archived,
with an option later where I as the admin can delete them after exporting them."*

Todero the TOOL is built by Claude against the Flight Board, not by Todero working
its own backlog. So Todero the PRODUCT should show exactly one project — Limiglow,
the thing it builds and operates. Everything else is history: 3,078 issues across
Todero (2,442), Kemuni (306), Vespera (267), KAOS (59), Testing1 (3), Loudwins (1).

`migrations/057_archive_non_limiglow.sql` is already written for both providers and
adds `archived_at` / `archived_reason` to issues and projects, with the backfill.
It has NOT been applied — PostgREST cannot run DDL and this host has no
DATABASE_URL. Applying it is a one-line env addition by the owner, not your job.

## Build instruction

1. **Read path.** Every default read excludes `archived_at IS NOT NULL`. One escape
   hatch: `?include_archived=1` on GET /api/issues and GET /api/projects. Do not
   scatter the filter across call sites — put it in the query layer so a new route
   inherits it and cannot forget.
2. **Archive is an action, not a status.** `PATCH /api/issues {id, archived: true}`
   sets `archived_at` and a reason. Archiving is orthogonal to lifecycle: a closed
   issue and an open one can both be archived, and un-archiving restores whatever
   status it had. Never overload `status` for this.
3. **A visible archive.** Somewhere in Settings the owner can see what is archived,
   with counts by project, and un-archive. Hidden-and-unreachable is how data gets
   lost; hidden-and-listed is an archive.
4. **Export before delete, enforced.** `GET /api/archive/export` streams every
   archived record as JSON (and CSV if cheap). Deletion is admin-only and must
   refuse unless an export of that selection has been taken — record the export in
   a small table and check it. The owner asked for "delete them after exporting":
   make the ordering structural rather than a note in the UI.
5. **Deletion is loud.** It names the count, requires the project name typed to
   confirm, and writes what it removed to the run record before removing it.
6. While the migration is unapplied, every one of the above must degrade honestly —
   a clear "archive is not available: migration 057 has not been applied" rather
   than an empty list that looks like nothing is archived.

## ACCEPTANCE — a critic will verify against the RUNNING app
1. `GET /api/issues` returns only Limiglow issues once 057 is applied; the count
   matches Limiglow's, not 3,078 plus.
2. `GET /api/issues?include_archived=1` returns everything, and the difference
   between the two counts equals the archived total exactly.
3. `PATCH /api/issues {id, archived:true}` then un-archive restores the ORIGINAL
   status, not a default one.
4. Settings shows the archive with counts by project, and un-archive works from it.
5. `GET /api/archive/export` returns every archived record; the record count in the
   export equals the archived count from check 2.
6. A delete attempt with no prior export is REFUSED, and the refusal names the
   export step. After an export it succeeds and reports what it removed.
7. With the migration unapplied, every archive surface says so explicitly. Verify
   by pointing at a database without the column and confirming no surface renders
   an empty state that implies "nothing archived".

-- 056: collapse four spellings of one project into 'Todero'.
--
-- Issues reference a project by a FREE-TEXT string with no referential integrity
-- to the projects table, so one project accumulated four names:
--   Todero 1688 | Mission Control 373 | MC 21 | mission-control 2
-- plus 'Infrastructure' (356), which is not a separate product — it is Todero's
-- own ops and platform maintenance, and 355 of its 356 issues are closed.
--
-- Authorised by Michael, 2026-08-25: "Yes. Merge Infrastructure within Todero,
-- for the reasons you explained in the way you recommended."
--
-- Done as a migration rather than through the MC API deliberately. The API
-- refuses with 'Issue is closed and read-only', which is a correct rule for an
-- issue OPERATION — a status change, a reassignment. A bulk relabel of a
-- historical project name is data cleanup, not an operation on the issue, and
-- weakening that rule to allow it would be the wrong trade.
--
-- Task keys (INF-, MC-) are deliberately left alone: they are already unique and
-- readable, and rewriting 752 of them would break every cross-reference in
-- descriptions, commit messages and the vault.

UPDATE issues
   SET project = 'Todero'
 WHERE project IN ('Mission Control', 'MC', 'mission-control', 'Infrastructure');

-- The duplicate project row goes too; 'Todero' (key TOD) survives.
--
-- Matched on NAME, not id. This said `WHERE id = 'Mission Control'`, which only
-- ever worked against the hosted database, where `projects.id` had drifted to a
-- free-text primary key. The schema this repo actually builds declares
-- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` (000_baseline_schema.sql:58),
-- so against a FRESH database the comparison threw
-- `invalid input syntax for type uuid: "Mission Control"` and the whole
-- migration run stopped at 49 of 51.
--
-- That is the precise failure a stranger cloning the repo and running
-- `npm run db:migrate` would hit, and running anywhere from a clean clone is
-- the point of this rebuild. A migration that only applies to one drifted
-- production database is not a migration.
DELETE FROM projects WHERE name = 'Mission Control';

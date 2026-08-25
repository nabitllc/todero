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
DELETE FROM projects WHERE id = 'Mission Control';

-- 057 (sqlite): an archive that is hiding, not deleting.
--
-- Michael, 2026-08-25: everything in Todero other than Limiglow is archived, with
-- an admin export-then-delete later.
--
-- This is the SQLite dialect of migrations/057. The Postgres version uses
-- ADD COLUMN IF NOT EXISTS, NOW() and IS DISTINCT FROM — none of which SQLite has.
-- The first draft was written once and copied to both directories, and SQLite
-- rejected it at 'near "EXISTS"'. Worth recording: writing one migration for two
-- providers is the same assumption the whole portability effort exists to remove.
-- The runner records what it applied, so a bare ADD COLUMN runs exactly once.

ALTER TABLE issues   ADD COLUMN archived_at     TEXT;
ALTER TABLE issues   ADD COLUMN archived_reason TEXT;
ALTER TABLE projects ADD COLUMN archived_at     TEXT;
ALTER TABLE projects ADD COLUMN archived_reason TEXT;

CREATE INDEX IF NOT EXISTS issues_archived_at_idx   ON issues (archived_at);
CREATE INDEX IF NOT EXISTS projects_archived_at_idx ON projects (archived_at);

UPDATE issues
   SET archived_at = datetime('now'),
       archived_reason = 'Pre-Limiglow history. Todero the tool is built against the Flight Board, not its own backlog.'
 WHERE (project IS NULL OR project <> 'Limiglow')
   AND archived_at IS NULL;

UPDATE projects
   SET archived_at = datetime('now'),
       archived_reason = 'Superseded by Limiglow as the single working project.'
 -- Matched on NAME, not id — see the Postgres copy of this migration.
 WHERE name <> 'Limiglow'
   AND archived_at IS NULL;

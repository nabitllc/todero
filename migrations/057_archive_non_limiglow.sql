-- 057: an archive that is hiding, not deleting.
--
-- Michael, 2026-08-25: "fully archive all of the tasks within Todero... everything
-- currently in Todero different from Limiglow should be archived, with an option
-- later where I as the admin can delete them after exporting them."
--
-- Todero the TOOL is built by Claude against the Flight Board, not by Todero
-- working its own backlog. So Todero the PRODUCT should show exactly one project:
-- Limiglow, the thing it builds and operates. Everything else is history.
--
-- archived_at NULL means active. Set means hidden from every default read, still
-- present, still exportable, deletable only by a deliberate admin action later.
-- Deliberately not a status value: archiving is orthogonal to lifecycle, and
-- overloading status would make "archived" compete with "closed" and "cancelled"
-- for the same field.

ALTER TABLE issues   ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ;
ALTER TABLE issues   ADD COLUMN IF NOT EXISTS archived_reason TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_reason TEXT;

CREATE INDEX IF NOT EXISTS issues_archived_at_idx   ON issues (archived_at);
CREATE INDEX IF NOT EXISTS projects_archived_at_idx ON projects (archived_at);

-- Backfill: everything that is not Limiglow.
UPDATE issues
   SET archived_at = NOW(),
       archived_reason = 'Pre-Limiglow history. Todero the tool is built against the Flight Board, not its own backlog.'
 WHERE project IS DISTINCT FROM 'Limiglow'
   AND archived_at IS NULL;

UPDATE projects
   SET archived_at = NOW(),
       archived_reason = 'Superseded by Limiglow as the single working project.'
 -- Matched on NAME, not id — same reason as 056: `projects.id` is a UUID in
 -- the schema this repo builds, so comparing it to a project NAME threw
 -- `invalid input syntax for type uuid: "Limiglow"` and stopped the run at 50
 -- of 51 against a fresh database.
 WHERE name IS DISTINCT FROM 'Limiglow'
   AND archived_at IS NULL;

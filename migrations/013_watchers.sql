-- TOD-1236 (2026-04-13): add watchers column for watcher notification support.
-- Each entry is a Discord user snowflake ID (raw 17-20 digit string).
-- Notifications are sent via Discord DM when issue transitions to completed/closed.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS watchers TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN issues.watchers IS
  'Array of Discord user snowflake IDs watching this issue. Notified on completion/closure. TOD-1236.';

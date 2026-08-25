-- TOD-818: Activity events table
-- Records issue lifecycle events for audit trail and analytics
--
-- NOTE (boot-migrations piece): renumbered from 011 -> 042 to resolve a
-- collision with 011_inbox.sql. That file had to stay at 011 because
-- 022_inbox_response_data_issue_fk.sql ALTERs the inbox table and must run
-- after it; nothing later references activity_events, so this one moved.

create table if not exists activity_events (
  id            uuid primary key default gen_random_uuid(),
  issue_id      uuid not null references issues(id) on delete cascade,
  issue_key     text,
  event_type    text not null,  -- issue_created | status_changed | assignee_changed | comment_added | field_changed
  actor         text,           -- agent id or user name
  actor_type    text,           -- 'agent' | 'human'
  metadata      jsonb,          -- event-specific payload (old_status, new_status, old_assignee, etc.)
  created_at    timestamptz not null default now()
);

create index if not exists activity_events_issue_id_idx on activity_events(issue_id);
create index if not exists activity_events_event_type_idx on activity_events(event_type);
create index if not exists activity_events_created_at_idx on activity_events(created_at desc);

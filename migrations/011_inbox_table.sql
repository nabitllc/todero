-- TOD-764: inbox table for agent approval requests.
-- Used by lib/inbox.ts requestApproval() — an agent inserts a row and polls
-- it until a human sets status to approved/denied (or the row times out).

create extension if not exists "uuid-ossp";

create table if not exists public.inbox (
  id            uuid primary key default uuid_generate_v4(),
  agent         text not null,
  type          text not null,
  context       jsonb,
  status        text not null default 'pending' check (status in ('pending','approved','denied','timeout')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  resolved_at   timestamptz,
  resolved_by   text
);

-- Indices for the three hot access patterns:
--  1. Polling by (agent, id)
--  2. UI listing of pending items
--  3. Timeout sweep
create index if not exists inbox_agent_idx on public.inbox (agent);
create index if not exists inbox_status_idx on public.inbox (status);
create index if not exists inbox_expires_idx on public.inbox (expires_at) where status = 'pending';

comment on table public.inbox is 'Agent approval requests created by lib/inbox.ts requestApproval() — polled until a human resolves them.';
comment on column public.inbox.agent is 'Requesting agent id (builder, po, etc.)';
comment on column public.inbox.type is 'Category of request: deploy, delete, send-message, etc.';
comment on column public.inbox.context is 'Arbitrary JSON context the reviewer needs to decide.';
comment on column public.inbox.status is 'pending → approved|denied|timeout (set once, immutable after).';

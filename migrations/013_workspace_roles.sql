-- TOD-906: Workspace roles and permissions model
-- Creates workspace_members table to store per-identity role assignments.
-- Roles: owner (full access + role management), member (full issue/board access),
--        viewer (read-only)

create type workspace_role as enum ('owner', 'member', 'viewer');

create table if not exists workspace_members (
  id          uuid primary key default gen_random_uuid(),
  identity    text not null,           -- username, email, or agent ID
  role        workspace_role not null default 'member',
  assigned_by text,                    -- identity of the owner who assigned this role
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint workspace_members_identity_unique unique (identity)
);

-- Auto-update updated_at on row change
create or replace function set_workspace_members_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_workspace_members_updated_at
  before update on workspace_members
  for each row execute procedure set_workspace_members_updated_at();

-- Seed: michael is the initial owner
insert into workspace_members (identity, role, assigned_by)
values ('michael', 'owner', 'system')
on conflict (identity) do nothing;

-- Role permission documentation view (read-only reference)
-- Permissions per role are enforced in application code (lib/rbac-types.ts)
comment on table workspace_members is
  'Workspace access control — TOD-906. '
  'Roles: owner (full access + roles:admin), member (issues/board write), viewer (read-only). '
  'Permission enforcement: middleware.ts (request layer) + app/api/roles/route.ts (roles API).';

-- TOD-2040: Hubs and hub_members tables
-- Creates hubs (multi-user workspaces) and hub_members (membership with roles).

create table if not exists hubs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null,
  owner_id   uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hubs_owner_slug_unique unique (owner_id, slug)
);

create table if not exists hub_members (
  id        uuid primary key default gen_random_uuid(),
  hub_id    uuid not null references hubs(id) on delete cascade,
  user_id   uuid references auth.users(id),
  role      text not null default 'member',
  joined_at timestamptz not null default now(),
  constraint hub_members_hub_user_unique unique (hub_id, user_id)
);

-- Auto-update updated_at on hubs row change
create or replace function set_hubs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hubs_updated_at on hubs;
create trigger trg_hubs_updated_at
  before update on hubs
  for each row execute procedure set_hubs_updated_at();

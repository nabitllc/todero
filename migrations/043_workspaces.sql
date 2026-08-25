-- Workspaces table for workspace settings (TOD-1603)
--
-- NOTE (boot-migrations piece): renumbered from 013 -> 043 to resolve a
-- collision with 013_workspace_roles.sql. workspace_roles (TOD-906, landed
-- 2026-04-13) predates this file (TOD-1603, landed 2026-04-22) and stayed at
-- 013; neither table has a foreign key to the other, so no ordering
-- constraint was broken by moving this one to the end.
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  billing_contact text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces (slug);

-- Seed a default workspace so the settings endpoint has something to update
INSERT INTO workspaces (name, slug)
VALUES ('Todero', 'todero')
ON CONFLICT (slug) DO NOTHING;

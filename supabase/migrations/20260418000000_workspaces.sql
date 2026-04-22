-- TOD-1603: Workspaces table for workspace settings endpoint
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

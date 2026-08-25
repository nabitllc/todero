-- Run in Supabase SQL Editor → kaos-ops project
-- https://supabase.com/dashboard/project/<your-project-ref>/editor

-- 1. Features table
CREATE TABLE IF NOT EXISTS features (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  project text NOT NULL,
  priority text CHECK (priority IN ('critical','high','medium','low')) DEFAULT 'medium',
  status text CHECK (status IN ('planned','active','complete','canceled')) DEFAULT 'planned',
  goal text,
  prd text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Add feature_id to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS feature_id uuid REFERENCES features(id);

-- 3. Projects table
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  purpose text,
  owner text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 4. Seed projects
INSERT INTO projects (id, name, description, purpose, owner) VALUES
('Vespera','Vespera','Goth community app for Colombia. Events, profiles, RSVP, social follow. Next.js + Supabase + Vercel.','User-facing product. Revenue via community → ticketing. Target: Colombian goth scene.','vespera-sme'),
('Kemuni','Kemuni','Community and property management SaaS. Tools for property managers and community organizers.','B2B SaaS. Revenue via subscriptions. Target: property managers, HOAs.','kemuni-sme'),
('Mission Control','Mission Control','Internal dashboard at kaos.nabit.work. Monitors agents, tasks, automations, project health.','Internal tool. Enables multi-agent orchestration for Michael.','main'),
('Infrastructure','Infrastructure','Everything that makes KAOS run: n8n, Supabase schema, agent configs, SOUL.md, sprint system, monitoring.','Internal ops. No external revenue. Powers all other projects.','main'),
('mission-control','mission-control','DEPRECATED — merge all tasks into Mission Control project.','Use Mission Control instead.','main')
ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, purpose=EXCLUDED.purpose;

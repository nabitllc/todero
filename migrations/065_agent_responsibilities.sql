-- 065: what each agent is RESPONSIBLE for, and who answers when an area stalls.
--      Postgres dialect; the SQLite copy is migrations/sqlite/065.
--
-- WHY THIS TABLE EXISTS AT ALL — the gap it closes
--   Todero already answers three questions about its fleet, and none of them is
--   this one:
--
--     who exists?              AGENTS.md, parsed by loadAgentRoster()
--     what CAN this agent do?  lib/agent-capabilities.ts (AGENT_REGISTRY)
--     what does it pick up?    lib/agent-queue.ts (pickupStatus/extraFilters)
--
--   "builder has the capability 'Coding'" is a statement about ability. It is
--   not the statement a business manager needs, which is "builder OWNS the
--   build area of this hub, and when nothing ships, builder is who you ask."
--   That second statement is an assignment made by a human, changes without a
--   code change, and has to be readable back. So it is data, and this is the
--   table.
--
-- WHY A ROW PER (business_id, area, agent_id) — and not the alternatives
--   Rejected: a column per agent on some hub row. Adding an agent would then be
--   a migration, and the roster is a MARKDOWN FILE that may add an agent with no
--   code change at all (lib/agent-roster.ts says exactly that). A schema that
--   cannot represent a roster addition is the wrong schema for this roster.
--
--   Rejected: a column per area on an agents row. Same objection mirrored, plus
--   `agents` is not the roster — AGENTS.md is — so a row there is not
--   guaranteed to exist for an agent the roster declares.
--
--   Chosen: the join row. It represents "many agents work an area" and "an agent
--   owns several areas" without either side needing DDL to grow, and it makes
--   the absence of a row meaningful: an area with no rows has NOBODY, which is
--   the single most useful thing this table can tell an operator.
--
-- WHY `level` IS TWO VALUES, NOT RACI'S FOUR
--   RACI is Responsible / Accountable / Consulted / Informed. Only the first two
--   create an obligation; C and I record who gets told, which this product has
--   no mechanism to act on and would therefore be decoration. Two values:
--
--     accountable  — answers when the area stalls. AT MOST ONE per (hub, area);
--                    see the partial unique index below. An area with two people
--                    accountable has nobody accountable.
--     responsible  — does the work in the area. Many allowed.
--
-- WHY `level` HAS A CHECK CONSTRAINT AND `area` DOES NOT
--   These look inconsistent and are not. `level` is a closed two-value concept
--   that this migration itself defines; a row carrying any other level is a row
--   the app cannot render, so the database should never hold one.
--   `area` is a PRODUCT vocabulary that grows — the declared list lives in
--   lib/agent-responsibilities.ts (AREAS) and is enforced on WRITE by
--   app/api/agent-responsibilities, the same fail-closed stance
--   app/api/hub-settings/route.ts takes for its setting keys ("an unknown key is
--   a typo or an injection, never a feature"). Putting that list in a SQL CHECK
--   would mean a migration every time the business names a new area, and
--   migrations/058_hub_settings.sql already set the precedent of validating a
--   growing vocabulary at the write path rather than in DDL.
--
-- WHY PER-HUB (business_id) AND NOT PER-PROJECT
--   Matches 058 (hub_settings) and 059 (hub_connections). The owner's model is
--   one hub containing many projects; accountability for "release" or "security"
--   is a standing fact about the company, not a per-ticket or per-project one.
--   The column is TEXT with no foreign key for the same reason hub_settings has
--   none: `businesses.id` is TEXT-shaped across the three adapters this repo
--   supports and the seam (lib/db.ts) does not model FKs.
--
-- RELATION TO CAPABILITIES — reported, never enforced here
--   There is deliberately NO column duplicating lib/agent-capabilities.ts. The
--   read path joins the two in memory and returns `capability_backed` per row,
--   so an assignment the capability map does not back is VISIBLE but still
--   allowed: an owner may deliberately hold the orchestrator accountable for
--   spend. Storing a copy of the capability list here would create a second
--   source of truth for it, which is the defect class this rebuild keeps
--   removing.
--
-- NOTHING IS SEEDED. There is no INSERT in this file and there must never be
-- one. An empty table means "no responsibilities are assigned yet" — a seeded
-- example would make it mean nothing at all.
--
-- NOTHING CONSULTS THESE ROWS YET. As of this migration, no dispatch path reads
-- agent_responsibilities: lib/agent-queue.ts, app/api/run-agent and the cron
-- lanes are untouched, and dispatch itself is off by default
-- (lib/dispatch-guard.ts). This table is a RECORD, not a CONTROL, and the UI
-- says so on screen. Recorded here so a later reader does not infer governance
-- from the existence of a schema.

CREATE TABLE IF NOT EXISTS agent_responsibilities (
  business_id TEXT        NOT NULL,
  area        TEXT        NOT NULL,
  agent_id    TEXT        NOT NULL,
  level       TEXT        NOT NULL CHECK (level IN ('accountable', 'responsible')),
  -- Free text from the person making the assignment: why this agent owns this.
  note        TEXT,
  -- The actor (role or human) who made the assignment. Written by the API from
  -- the resolved caller role; never accepted from the request body.
  assigned_by TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, area, agent_id)
);

-- The constraint that makes "who answers when this stalls" single-valued.
-- Partial, because `responsible` is intentionally many-per-area.
CREATE UNIQUE INDEX IF NOT EXISTS agent_responsibilities_one_accountable_idx
  ON agent_responsibilities (business_id, area)
  WHERE level = 'accountable';

-- "What does this agent own?" — the Fleet detail direction of the same table.
CREATE INDEX IF NOT EXISTS agent_responsibilities_agent_idx
  ON agent_responsibilities (business_id, agent_id);

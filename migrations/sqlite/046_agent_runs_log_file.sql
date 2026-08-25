-- run-agent-locally piece: mirrors migrations/046_agent_runs_log_file.sql
-- for the sqlite adapter (sqlite-adapter piece) — see that file for why.
ALTER TABLE agent_runs ADD COLUMN log_file text;

-- agent_documents: stores agent identity files (soul, agents handbook, skills, heartbeat)
CREATE TABLE IF NOT EXISTS agent_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    text NOT NULL,
  doc_type    text NOT NULL CHECK (doc_type IN ('soul', 'agents', 'skill', 'heartbeat')),
  slug        text NOT NULL,
  content     text NOT NULL DEFAULT '',
  updated_at  timestamptz DEFAULT now(),
  updated_by  text,
  UNIQUE (agent_id, doc_type, slug)
);

-- history: full snapshots on every update (diffs computed client-side)
CREATE TABLE IF NOT EXISTS agent_document_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES agent_documents(id) ON DELETE CASCADE,
  content     text NOT NULL,
  changed_by  text,
  changed_at  timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION snapshot_agent_document()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO agent_document_history(document_id, content, changed_by, changed_at)
  VALUES (OLD.id, OLD.content, OLD.updated_by, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_doc_history ON agent_documents;
CREATE TRIGGER agent_doc_history
BEFORE UPDATE ON agent_documents
FOR EACH ROW EXECUTE FUNCTION snapshot_agent_document();

-- agent_memory: daily logs, long-term memory, self-improving, session state
CREATE TABLE IF NOT EXISTS agent_memory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    text NOT NULL,
  memory_type text NOT NULL CHECK (memory_type IN ('daily', 'long_term', 'self_improving', 'corrections', 'session_state')),
  date_key    text,
  content     text NOT NULL DEFAULT '',
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (agent_id, memory_type, date_key)
);

-- Atomic issue claim — prevents WIP race condition in run-agent.
-- Returns TRUE if the issue was claimed, FALSE if WIP limit was already reached
-- or the issue was claimed by a concurrent request.
CREATE OR REPLACE FUNCTION claim_issue(
  p_issue_id   UUID,
  p_agent_id   TEXT,
  p_pickup_status  TEXT,
  p_working_status TEXT,
  p_wip_limit  INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE issues
  SET
    status     = p_working_status,
    started_at = COALESCE(started_at, NOW()),
    updated_at = NOW()
  WHERE id        = p_issue_id
    AND status    = p_pickup_status
    AND assignee  = p_agent_id
    AND (
      SELECT COUNT(*)
      FROM issues
      WHERE assignee = p_agent_id
        AND status   = p_working_status
    ) < p_wip_limit;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

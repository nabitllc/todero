-- TOD-XXX (2026-04-10): add closing_notes field for auditor sign-off.
-- Required for released/completed → closed transition (enforced in API).

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS closing_notes TEXT;

COMMENT ON COLUMN issues.closing_notes IS
  'Auditor closing notes — required when transitioning released/completed to closed. Describes the final audit outcome.';

-- INF-181: Add fail_count column to issues table for tester escalation tracking
-- Run this in Supabase SQL editor: https://supabase.com/dashboard/project/twthgapiouiqhavrcnry/sql
ALTER TABLE issues ADD COLUMN IF NOT EXISTS fail_count integer DEFAULT 0;

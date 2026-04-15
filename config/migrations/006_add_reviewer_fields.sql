-- Migration 006: Add reviewer and reviewed_by fields to issues table
-- reviewer: who is assigned to review (auto-set on → in_review based on severity)
-- reviewed_by: who actually completed the review (set on → done)
-- Created: 2026-03-30

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS reviewer text,
  ADD COLUMN IF NOT EXISTS reviewed_by text;

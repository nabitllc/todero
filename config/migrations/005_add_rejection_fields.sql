-- Migration 005: Add rejection tracking fields to issues table
-- Created: 2026-03-30

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS rejection_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_rejection_reason text;

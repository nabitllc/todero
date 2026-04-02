-- INF-663: Add UNIQUE constraint on task_key to prevent future duplicates
-- This migration was auto-generated after fixing 36 duplicate task_keys on 2026-04-02 03:00 EDT.
-- Root cause: API fallback to MAX(task_number)+1 allowed concurrent requests to assign same key.
-- Fix: Deduplicated all collisions, then enforcing UNIQUE constraint.

BEGIN;

-- Add UNIQUE constraint on task_key
-- task_key should never be NULL; NOT NULL constraint already exists
ALTER TABLE public.issues
ADD CONSTRAINT unique_task_key UNIQUE (task_key);

-- Verify trigger is present (created in 20260331051000_task_key_sequence_hardening.sql)
-- Trigger: trg_mc_assign_issue_identity
-- RPC: next_task_number() — allocates from mc_task_seq

COMMIT;

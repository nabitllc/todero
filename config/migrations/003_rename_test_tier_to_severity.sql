-- Migration 003: Rename test_tier → severity, values P0/P1/P2/P3 → S0/S1/S2/S3
-- Applied: 2026-03-30

-- Step 1: Rename the column
ALTER TABLE issues RENAME COLUMN test_tier TO severity;

-- Step 2: Update all existing values
UPDATE issues SET severity = 'S0' WHERE severity = 'P0';
UPDATE issues SET severity = 'S1' WHERE severity = 'P1';
UPDATE issues SET severity = 'S2' WHERE severity = 'P2';
UPDATE issues SET severity = 'S3' WHERE severity = 'P3';

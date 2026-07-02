-- Migration 0058: Add notes column to claim_items
-- Adds an optional free-text note per claim item row.

ALTER TABLE claim_items
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN claim_items.notes IS 'Optional per-item note / remark entered by the user';

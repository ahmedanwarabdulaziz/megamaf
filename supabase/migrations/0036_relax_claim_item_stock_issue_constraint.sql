-- 0036_relax_claim_item_stock_issue_constraint.sql
--
-- The old constraint (0014) required warehouse_id + item_id to be NOT NULL
-- whenever is_stock_issue = true. The new bundle system (0035) stores items
-- in claim_item_stock_bundles instead, so both columns are intentionally NULL
-- for new-style records. Relax the constraint to allow that.

ALTER TABLE public.claim_items
  DROP CONSTRAINT IF EXISTS chk_claim_item_stock_issue;

ALTER TABLE public.claim_items
  ADD CONSTRAINT chk_claim_item_stock_issue CHECK (
    -- Normal item — no stock deduction
    (is_stock_issue = false)
    OR
    -- New bundle-style: warehouse/item stored in claim_item_stock_bundles
    (is_stock_issue = true AND warehouse_id IS NULL AND item_id IS NULL)
    OR
    -- Legacy single-item style: both columns populated together
    (is_stock_issue = true AND warehouse_id IS NOT NULL AND item_id IS NOT NULL)
  );

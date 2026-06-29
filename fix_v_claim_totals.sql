-- This completely fixes the "إجمالي المستحق" shrinking bug.
-- The old view incorrectly deducted cash payments from the claim's amount_due,
-- which caused double-deduction when added to the ledger.
-- Now, total_due_this_claim is purely the DELTA (new work) added in this claim.

CREATE OR REPLACE VIEW public.v_claim_totals WITH (security_invoker = true) AS
WITH item_math AS (
  SELECT
    ci.claim_id,
    (ci.previous_qty + ci.current_qty) * ci.unit_price                         AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct   AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct) AS cumulative_retained,
    (ci.current_qty) * ci.unit_price * ci.disbursement_pct                     AS current_payable
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT
    claim_id,
    SUM(cumulative_line_total)  AS claim_cumulative_total,
    SUM(cumulative_payable)     AS claim_cumulative_payable,
    SUM(cumulative_retained)    AS claim_cumulative_retained,
    SUM(current_payable)        AS claim_current_payable
  FROM item_math
  GROUP BY claim_id
)
SELECT
  c.id                                               AS claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  -- prior_cumulative_payable = everything before this claim
  GREATEST(cs.claim_cumulative_payable - cs.claim_current_payable, 0) AS prior_cumulative_payable,
  -- Net payable before tax is EXACTLY the work done this period
  cs.claim_current_payable                           AS net_payable_before_tax,
  -- Tax
  CASE WHEN c.tax_enabled
    THEN cs.claim_current_payable * c.tax_rate
    ELSE 0
  END                                                AS tax_amount,
  -- Total certificate amount is the net delta payable + tax
  cs.claim_current_payable +
  CASE WHEN c.tax_enabled
    THEN cs.claim_current_payable * c.tax_rate
    ELSE 0
  END                                                AS total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs ON cs.claim_id = c.id;

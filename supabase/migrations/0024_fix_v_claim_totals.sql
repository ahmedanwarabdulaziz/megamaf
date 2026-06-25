-- Fix v_claim_totals: total_due_this_claim should be
-- cumulative_payable - actual_cash_paid (from ledger), not prior_claim_cumulative.
-- This matches the agreed cumulative logic: claim N is the truth;
-- what you owe = its cumulative net − what you've already received.

CREATE OR REPLACE VIEW public.v_claim_totals AS
WITH item_math AS (
  SELECT
    ci.claim_id,
    (ci.previous_qty + ci.current_qty) * ci.unit_price                         AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct   AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct) AS cumulative_retained
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT
    claim_id,
    SUM(cumulative_line_total)  AS claim_cumulative_total,
    SUM(cumulative_payable)     AS claim_cumulative_payable,
    SUM(cumulative_retained)    AS claim_cumulative_retained
  FROM item_math
  GROUP BY claim_id
),
-- Sum of all actual payments recorded in the ledger for every claim
-- belonging to the same party + project + claim_type
actual_paid_per_party_project AS (
  SELECT
    c.party_id,
    c.project_id,
    c.claim_type,
    COALESCE(SUM(vcp.paid_amount), 0) AS total_actually_paid
  FROM public.claims c
  LEFT JOIN public.v_claim_paid vcp ON vcp.claim_id = c.id
  GROUP BY c.party_id, c.project_id, c.claim_type
)
SELECT
  c.id                                            AS claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  ap.total_actually_paid                          AS prior_cumulative_payable,
  -- Net payable before tax = cumulative payable − all cash received so far
  GREATEST(cs.claim_cumulative_payable - ap.total_actually_paid, 0) AS net_payable_before_tax,
  -- Tax on the net amount
  CASE WHEN c.tax_enabled
    THEN GREATEST(cs.claim_cumulative_payable - ap.total_actually_paid, 0) * c.tax_rate
    ELSE 0
  END AS tax_amount,
  -- Total certificate amount
  GREATEST(cs.claim_cumulative_payable - ap.total_actually_paid, 0)
  + CASE WHEN c.tax_enabled
      THEN GREATEST(cs.claim_cumulative_payable - ap.total_actually_paid, 0) * c.tax_rate
      ELSE 0
    END AS total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs ON cs.claim_id = c.id
LEFT JOIN actual_paid_per_party_project ap
       ON ap.party_id = c.party_id
      AND ap.project_id = c.project_id
      AND ap.claim_type = c.claim_type;

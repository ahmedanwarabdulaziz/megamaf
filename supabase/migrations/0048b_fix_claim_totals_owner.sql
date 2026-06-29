-- Quick SQL to run in Supabase SQL Editor
-- Updates v_claim_totals to factor in prior_owner_dues as Claim #0 offset for owner claims

DROP VIEW IF EXISTS public.v_claim_totals CASCADE;

CREATE OR REPLACE VIEW public.v_claim_totals WITH (security_invoker = true) AS
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
in_system_prior AS (
  SELECT
    c.id AS claim_id,
    COALESCE(
      (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
       FROM public.claims pc
       JOIN public.claim_items pci ON pci.claim_id = pc.id
       WHERE pc.project_id = c.project_id
         AND pc.party_id   = c.party_id
         AND pc.claim_number < c.claim_number
         AND pc.status = 'approved'
         AND pc.claim_type = c.claim_type
      ), 0
    ) AS in_system_prior_payable
  FROM public.claims c
)
SELECT
  c.id                                              AS claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,

  isp.in_system_prior_payable
    + CASE
        WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
        WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
        ELSE 0
      END                                           AS prior_cumulative_payable,

  cs.claim_cumulative_payable
    - isp.in_system_prior_payable
    - CASE
        WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
        WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
        ELSE 0
      END                                           AS net_payable_before_tax,

  CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable
      - isp.in_system_prior_payable
      - CASE
          WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
          WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
          ELSE 0
        END) * c.tax_rate
  ELSE 0 END                                        AS tax_amount,

  (cs.claim_cumulative_payable
    - isp.in_system_prior_payable
    - CASE
        WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
        WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
        ELSE 0
      END)
  + CASE WHEN c.tax_enabled THEN
      (cs.claim_cumulative_payable
        - isp.in_system_prior_payable
        - CASE
            WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
            WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
            ELSE 0
          END) * c.tax_rate
    ELSE 0 END                                      AS total_due_this_claim

FROM public.claims c
LEFT JOIN claim_sums  cs  ON cs.claim_id   = c.id
LEFT JOIN in_system_prior isp ON isp.claim_id = c.id
LEFT JOIN public.vendor_prior_claims vpc
       ON vpc.project_id = c.project_id
      AND vpc.vendor_id  = c.party_id
      AND c.claim_type   = 'vendor'
LEFT JOIN public.project_opening_balances ob
       ON ob.project_id  = c.project_id
      AND c.claim_type   = 'owner';

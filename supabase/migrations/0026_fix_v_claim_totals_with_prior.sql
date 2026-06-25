-- 0026_fix_v_claim_totals_with_prior.sql
-- Fix v_claim_totals after 0025 introduced vendor_prior_claims.
-- Strategy: keep 0024's approach (actual cash paid from ledger as the deduction)
-- but ALSO add prior_certified_amount from vendor_prior_claims as an additional
-- historical offset in prior_cumulative_payable.
-- Result for Claim #1 of vendor with prior history:
--   net_payable_before_tax = cumulative_payable - prior_certified_amount - total_actually_paid
-- This ensures the first in-system claim only bills the delta over pre-existing work.

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
-- Sum of all actual payments recorded in the ledger for this party+project+type
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
  c.id                                               AS claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  -- prior_cumulative_payable = historical certified (Claim #0) + actual ledger payments
  ap.total_actually_paid
    + COALESCE(vpc.prior_certified_amount, 0)        AS prior_cumulative_payable,
  -- Net payable before tax = cumulative payable − all prior certified − all cash received
  GREATEST(
    cs.claim_cumulative_payable
      - COALESCE(vpc.prior_certified_amount, 0)
      - ap.total_actually_paid,
    0
  )                                                  AS net_payable_before_tax,
  -- Tax
  CASE WHEN c.tax_enabled
    THEN GREATEST(
      cs.claim_cumulative_payable
        - COALESCE(vpc.prior_certified_amount, 0)
        - ap.total_actually_paid,
      0
    ) * c.tax_rate
    ELSE 0
  END                                                AS tax_amount,
  -- Total certificate amount
  GREATEST(
    cs.claim_cumulative_payable
      - COALESCE(vpc.prior_certified_amount, 0)
      - ap.total_actually_paid,
    0
  )
  + CASE WHEN c.tax_enabled
      THEN GREATEST(
        cs.claim_cumulative_payable
          - COALESCE(vpc.prior_certified_amount, 0)
          - ap.total_actually_paid,
        0
      ) * c.tax_rate
      ELSE 0
    END                                              AS total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs ON cs.claim_id = c.id
LEFT JOIN actual_paid_per_party_project ap
       ON ap.party_id    = c.party_id
      AND ap.project_id  = c.project_id
      AND ap.claim_type  = c.claim_type
-- Only apply prior offset for vendor claims (owner claims have no prior)
LEFT JOIN public.vendor_prior_claims vpc
       ON vpc.project_id = c.project_id
      AND vpc.vendor_id  = c.party_id
      AND c.claim_type   = 'vendor';

-- Restore v_project_financial_position which was cascaded with v_claim_totals
-- (0025 already has the correct version, we just need to recreate it)
DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(CASE WHEN claim_type = 'owner'  THEN total_due_this_claim     ELSE 0 END) AS owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim     ELSE 0 END) AS vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) AS vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) AS invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
expenses_agg AS (
    SELECT project_id, SUM(amount) AS total_employee_expenses
    FROM public.expenses
    WHERE status = 'approved'
      AND project_id IS NOT NULL
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) AS retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) AS total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
    UNION ALL
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
    UNION ALL
    SELECT r.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
),
vendor_cash AS (
    SELECT project_id, SUM(amount) AS total_paid
    FROM vendor_allocations
    GROUP BY project_id
),
prior_vendor_claims_agg AS (
    SELECT
        project_id,
        SUM(prior_certified_amount) AS total_prior_certified,
        SUM(prior_paid_amount)      AS total_prior_paid,
        SUM(prior_retention_held)   AS total_prior_retention,
        COUNT(*)                    AS vendor_count
    FROM public.vendor_prior_claims
    GROUP BY project_id
),
inventory_receipts AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END)                                    AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END)       AS total_value_in
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
),
inventory_avg_cost AS (
    SELECT
        ir.project_id,
        ir.item_id,
        CASE WHEN ir.total_qty_in > 0
             THEN ir.total_value_in / ir.total_qty_in
             ELSE 0
        END AS avg_cost
    FROM inventory_receipts ir
),
inventory_on_hand AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(sm.qty) AS qty_on_hand
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
    HAVING SUM(sm.qty) > 0
),
inventory_asset AS (
    SELECT
        ioh.project_id,
        SUM(ioh.qty_on_hand * iac.avg_cost) AS total_asset_value
    FROM inventory_on_hand ioh
    JOIN inventory_avg_cost iac
      ON iac.project_id = ioh.project_id
     AND iac.item_id    = ioh.item_id
    GROUP BY ioh.project_id
)
SELECT
    p.id   AS project_id,
    p.name,
    p.code,
    p.node_type,

    -- ► Opening balance metadata
    CASE WHEN ob.id IS NOT NULL THEN true ELSE false END  AS has_opening_balance,
    ob.cutoff_date                                         AS opening_cutoff_date,
    COALESCE(ob.prior_expenses,     0)                     AS prior_expenses,
    COALESCE(ob.prior_owner_income, 0)                     AS prior_owner_income,

    -- ► Vendor prior claims summary (informational)
    COALESCE(pvca.total_prior_certified,  0)               AS prior_vendor_certified,
    COALESCE(pvca.total_prior_paid,       0)               AS prior_vendor_paid,
    COALESCE(pvca.total_prior_retention,  0)               AS prior_vendor_retention,
    COALESCE(pvca.vendor_count,           0)               AS prior_vendor_count,

    -- ► In-system figures
    COALESCE(pca.owner_billed,  0)                         AS in_system_income,
    COALESCE(oc.total_received, 0)                         AS total_received,
    COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS in_system_expenses,
    COALESCE(vc.total_paid, 0)                             AS total_paid,
    COALESCE(pca.vendor_retained, 0)
      - COALESCE(rra.retention_released, 0)               AS retention_held,

    -- ► Inventory asset (items still in warehouse, avg cost)
    COALESCE(ia_asset.total_asset_value, 0)                AS inventory_asset_value,

    -- ► Grand totals (prior + in-system)
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)                      AS total_income,

    COALESCE(ob.prior_expenses, 0)
      + COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS total_expenses,

    -- balance = total_income − total_expenses
    -- (inventory_asset_value is shown separately as an asset, not deducted)
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS balance,

    -- net_position (alias kept for homepage compatibility)
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS net_position

FROM public.projects p
LEFT JOIN public.project_opening_balances ob  ON ob.project_id  = p.id
LEFT JOIN proj_claims_agg                 pca ON pca.project_id = p.id
LEFT JOIN invoices_agg                    ia  ON ia.project_id  = p.id
LEFT JOIN expenses_agg                    ea  ON ea.project_id  = p.id
LEFT JOIN retention_releases_agg          rra ON rra.project_id = p.id
LEFT JOIN owner_cash                      oc  ON oc.project_id  = p.id
LEFT JOIN vendor_cash                     vc  ON vc.project_id  = p.id
LEFT JOIN prior_vendor_claims_agg         pvca ON pvca.project_id = p.id
LEFT JOIN inventory_asset                 ia_asset ON ia_asset.project_id = p.id;

-- =============================================================================
-- Migration 0051: Fix v_project_financial_position — vendor_claims_billed double-count
--
-- Problem: The proj_claims CTE summed claim_cumulative_total across ALL approved
-- vendor claims per project. Since claim_cumulative_total is already a running
-- cumulative (Claim #2 already includes Claim #1 work), summing Claim #1 + Claim #2
-- double-counts Claim #1's work:
--   Claim #1: claim_cumulative_total = 1,000
--   Claim #2: claim_cumulative_total = 1,000  (same cumulative, no new work)
--   SUM = 2,000  ← WRONG (should be 1,000)
--   + prior_vendor_certified = 3,344
--   Total shown = 5,344  ← WRONG (should be 4,344)
--
-- Fix: Use DISTINCT ON (party_id, project_id) ordered DESC to take only the
-- LATEST claim's cumulative total per vendor+project, then sum across vendors.
-- =============================================================================

DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH
-- Latest approved claim per vendor+project (avoids cumulative double-count)
latest_vendor_claims AS (
    SELECT DISTINCT ON (c.party_id, c.project_id)
        c.project_id,
        vct.claim_cumulative_total    AS gross_in_system,
        vct.claim_cumulative_retained AS retained_in_system,
        vct.total_due_this_claim
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status     = 'approved'
      AND c.claim_type = 'vendor'
    ORDER BY c.party_id, c.project_id, c.claim_number DESC
),
-- Owner claims: total_due_this_claim IS correct to sum (each claim is incremental)
owner_claims AS (
    SELECT
        c.project_id,
        vct.total_due_this_claim
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status     = 'approved'
      AND c.claim_type = 'owner'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(gross_in_system)    AS vendor_billed,
        SUM(retained_in_system) AS vendor_retained
    FROM latest_vendor_claims
    GROUP BY project_id
),
owner_claims_agg AS (
    SELECT
        project_id,
        SUM(total_due_this_claim) AS owner_billed
    FROM owner_claims
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
-- Payments against vendor claims (sum across ALL claims per vendor+project)
vendor_claim_payments AS (
    SELECT
        c.project_id,
        COALESCE(SUM(vcp.paid_amount), 0) AS paid_in_system
    FROM public.claims c
    JOIN public.v_claim_paid vcp ON vcp.claim_id = c.id
    WHERE c.claim_type = 'vendor'
      AND c.status     = 'approved'
    GROUP BY c.project_id
),
-- Payments against owner claims
owner_claim_payments AS (
    SELECT
        c.project_id,
        COALESCE(SUM(vcp.paid_amount), 0) AS paid_in_system
    FROM public.claims c
    JOIN public.v_claim_paid vcp ON vcp.claim_id = c.id
    WHERE c.claim_type = 'owner'
      AND c.status     = 'approved'
    GROUP BY c.project_id
),
invoice_payments AS (
    SELECT
        i.project_id,
        COALESCE(SUM(vip.paid_amount), 0) AS paid
    FROM public.invoices i
    JOIN public.v_invoice_paid vip ON vip.invoice_id = i.id
    WHERE i.status = 'approved'
    GROUP BY i.project_id
),
-- Prior (Claim #0) vendor aggregates — from vendor_prior_claims, not project_opening_balances
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
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END)                              AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END) AS total_value_in
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
        SUM(ioh.qty_on_hand * iac.avg_cost) AS asset_value
    FROM inventory_on_hand ioh
    JOIN inventory_avg_cost iac
      ON iac.project_id = ioh.project_id
     AND iac.item_id    = ioh.item_id
    GROUP BY ioh.project_id
)
SELECT
    p.id                                                                    AS project_id,
    p.name,
    p.code,
    p.node_type,

    -- Opening balance presence
    ob.id IS NOT NULL                                                       AS has_opening_balance,
    ob.cutoff_date                                                          AS opening_cutoff_date,

    -- Prior figures: ob columns + vendor_prior_claims aggregate
    COALESCE(ob.prior_expenses,           0)                               AS prior_expenses,
    COALESCE(ob.prior_owner_income,       0)                               AS prior_owner_income,
    COALESCE(ob.prior_owner_dues,         0)                               AS prior_owner_dues,
    COALESCE(pvca.total_prior_certified,  0)                               AS prior_vendor_certified,
    COALESCE(pvca.total_prior_paid,       0)                               AS prior_vendor_paid,
    COALESCE(pvca.total_prior_retention,  0)                               AS prior_vendor_retention,
    COALESCE(pvca.vendor_count,           0)                               AS prior_vendor_count,

    -- In-system vendor claims (latest cumulative per vendor — no double-count)
    COALESCE(pca.vendor_billed,          0)                                AS vendor_claims_billed,
    COALESCE(vcp_agg.paid_in_system,     0)                                AS vendor_claims_paid,

    -- In-system invoices
    COALESCE(inv_agg.invoice_total,      0)                                AS invoices_billed,
    COALESCE(ip.paid,                    0)                                AS invoices_paid,

    -- Employee expenses
    COALESCE(ea.total_employee_expenses, 0)                                AS employee_expenses_billed,
    COALESCE(ea.total_employee_expenses, 0)                                AS employee_expenses_paid,

    -- Owner income (in-system)
    COALESCE(ocp_agg.paid_in_system,     0)                                AS owner_paid,
    COALESCE(oca.owner_billed,           0)                                AS in_system_income,

    -- Totals (in-system only, prior added by the UI)
    COALESCE(ocp_agg.paid_in_system,     0)                                AS total_received,
    COALESCE(pca.vendor_billed,          0)
      + COALESCE(inv_agg.invoice_total,  0)
      + COALESCE(ea.total_employee_expenses, 0)                            AS in_system_expenses,
    COALESCE(vcp_agg.paid_in_system,     0)
      + COALESCE(ip.paid,               0)
      + COALESCE(ea.total_employee_expenses, 0)                            AS total_paid,

    -- Retention held (from vendor claims)
    COALESCE(pca.vendor_retained,        0)                                AS retention_held,

    -- Inventory
    COALESCE(inv_asset.asset_value,      0)                                AS inventory_asset_value,

    -- Grand totals (for balance calculation — prior + in-system)
    COALESCE(oca.owner_billed,           0) + COALESCE(ob.prior_owner_dues, 0)  AS total_income,
    COALESCE(pca.vendor_billed,           0) + COALESCE(pvca.total_prior_certified, 0)
      + COALESCE(inv_agg.invoice_total,   0)
      + COALESCE(ea.total_employee_expenses, 0)
      + COALESCE(ob.prior_expenses,       0)                               AS total_expenses,

    -- Net position
    (COALESCE(oca.owner_billed,           0) + COALESCE(ob.prior_owner_dues, 0))
    - (
        COALESCE(pca.vendor_billed,       0) + COALESCE(pvca.total_prior_certified, 0)
        + COALESCE(inv_agg.invoice_total, 0)
        + COALESCE(ea.total_employee_expenses, 0)
        + COALESCE(ob.prior_expenses,     0)
      )
    + COALESCE(inv_asset.asset_value,     0)                               AS balance,

    (COALESCE(oca.owner_billed,           0) + COALESCE(ob.prior_owner_dues, 0))
    - (
        COALESCE(pca.vendor_billed,       0) + COALESCE(pvca.total_prior_certified, 0)
        + COALESCE(inv_agg.invoice_total, 0)
        + COALESCE(ea.total_employee_expenses, 0)
        + COALESCE(ob.prior_expenses,     0)
      )
    + COALESCE(inv_asset.asset_value,     0)                               AS net_position

FROM public.projects p
LEFT JOIN public.project_opening_balances ob          ON ob.project_id      = p.id
LEFT JOIN prior_vendor_claims_agg         pvca         ON pvca.project_id    = p.id
LEFT JOIN proj_claims_agg                 pca          ON pca.project_id     = p.id
LEFT JOIN owner_claims_agg                oca          ON oca.project_id     = p.id
LEFT JOIN invoices_agg                    inv_agg      ON inv_agg.project_id = p.id
LEFT JOIN expenses_agg                    ea           ON ea.project_id      = p.id
LEFT JOIN vendor_claim_payments           vcp_agg      ON vcp_agg.project_id = p.id
LEFT JOIN owner_claim_payments            ocp_agg      ON ocp_agg.project_id = p.id
LEFT JOIN invoice_payments                ip           ON ip.project_id      = p.id
LEFT JOIN inventory_asset                 inv_asset    ON inv_asset.project_id = p.id;

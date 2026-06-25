-- 0032_project_financial_summary.sql
-- Updates v_project_financial_position to separate paid/billed amounts for project cards UI

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
    SELECT project_id, 
           SUM(amount) AS total_employee_expenses,
           SUM(settled_amount) AS total_employee_expenses_paid
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
    SELECT i.project_id, pa.allocated_amount, 'invoice' AS type
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    UNION ALL
    SELECT c.project_id, pa.allocated_amount, 'vendor_claim' AS type
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    UNION ALL
    SELECT r.project_id, pa.allocated_amount, 'retention' AS type
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
),
vendor_cash_split AS (
    SELECT 
        project_id, 
        SUM(allocated_amount) AS total_paid,
        SUM(CASE WHEN type = 'invoice' THEN allocated_amount ELSE 0 END) AS invoice_paid,
        SUM(CASE WHEN type = 'vendor_claim' THEN allocated_amount ELSE 0 END) AS vendor_claim_paid,
        SUM(CASE WHEN type = 'retention' THEN allocated_amount ELSE 0 END) AS retention_paid
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
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END)               AS total_qty_in,
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

    -- ? Opening balance metadata
    CASE WHEN ob.id IS NOT NULL THEN true ELSE false END  AS has_opening_balance,
    ob.cutoff_date                                         AS opening_cutoff_date,
    COALESCE(ob.prior_expenses,     0)                     AS prior_expenses,
    COALESCE(ob.prior_owner_income, 0)                     AS prior_owner_income,

    -- ? Vendor prior claims summary (informational)
    COALESCE(pvca.total_prior_certified,  0)               AS prior_vendor_certified,
    COALESCE(pvca.total_prior_paid,       0)               AS prior_vendor_paid,
    COALESCE(pvca.total_prior_retention,  0)               AS prior_vendor_retention,
    COALESCE(pvca.vendor_count,           0)               AS prior_vendor_count,

    -- ? In-system figures (Breakdown)
    COALESCE(pca.owner_billed,  0)                         AS owner_billed,
    COALESCE(oc.total_received, 0)                         AS owner_paid,
    
    COALESCE(pca.vendor_billed, 0)                         AS vendor_claims_billed,
    COALESCE(vcs.vendor_claim_paid, 0)                     AS vendor_claims_paid,
    
    COALESCE(ia.invoice_total, 0)                          AS invoices_billed,
    COALESCE(vcs.invoice_paid, 0)                          AS invoices_paid,
    
    COALESCE(ea.total_employee_expenses, 0)                AS employee_expenses_billed,
    COALESCE(ea.total_employee_expenses_paid, 0)           AS employee_expenses_paid,

    COALESCE(pca.vendor_retained, 0)
      - COALESCE(rra.retention_released, 0)               AS retention_held,

    -- ? Backward compatible in-system aggregations
    COALESCE(pca.owner_billed,  0)                         AS in_system_income,
    COALESCE(oc.total_received, 0)                         AS total_received,
    COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS in_system_expenses,
    COALESCE(vcs.total_paid, 0)                            AS total_paid,

    -- ? Inventory asset (items still in warehouse, avg cost)
    COALESCE(ia_asset.total_asset_value, 0)                AS inventory_asset_value,

    -- ? Grand totals
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)                      AS total_income,

    COALESCE(ob.prior_expenses, 0)
      + COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS total_expenses,

    -- balance = total_income ? total_expenses
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS balance,
      
    -- ? Profit (New calculations)
    (
      COALESCE(ob.prior_owner_income, 0) + COALESCE(pca.owner_billed, 0)
    ) - (
      (COALESCE(ob.prior_expenses, 0) + COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) + COALESCE(ea.total_employee_expenses, 0))
      - COALESCE(ia_asset.total_asset_value, 0)
    ) AS net_profit

FROM public.projects p
LEFT JOIN public.project_opening_balances ob  ON ob.project_id  = p.id
LEFT JOIN proj_claims_agg                 pca ON pca.project_id = p.id
LEFT JOIN invoices_agg                    ia  ON ia.project_id  = p.id
LEFT JOIN expenses_agg                    ea  ON ea.project_id  = p.id
LEFT JOIN retention_releases_agg          rra ON rra.project_id = p.id
LEFT JOIN owner_cash                      oc  ON oc.project_id  = p.id
LEFT JOIN vendor_cash_split               vcs ON vcs.project_id = p.id
LEFT JOIN prior_vendor_claims_agg         pvca ON pvca.project_id = p.id
LEFT JOIN inventory_asset                 ia_asset ON ia_asset.project_id = p.id;

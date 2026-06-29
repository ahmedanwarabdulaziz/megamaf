-- 0049_financial_position_breakdown.sql
-- Adds per-category expense breakdown columns to v_project_financial_position
-- so the project-card.tsx can show each expense type separately.
--
-- New columns:
--   vendor_claims_billed     (vendor claim total_due_this_claim sum, in-system)
--   invoices_billed          (approved invoices total)
--   employee_expenses_billed (approved employee expenses)
--   vendor_claims_paid       (payments allocated to vendor claims)
--   invoices_paid            (payments allocated to invoices)
--   employee_expenses_paid   (approved expenses that are also paid — using amount directly)
--   owner_paid               (payments received from owner, in-system)

DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_total,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(CASE WHEN claim_type = 'owner'  THEN total_due_this_claim     ELSE 0 END) AS owner_billed,
        -- Use gross cumulative total for vendor claims (retention tracked separately)
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_total    ELSE 0 END) AS vendor_billed,
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
-- Owner cash: payments received from owner (claim allocations + schedule allocations)
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
-- Vendor claims payments
vendor_claim_payments AS (
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
),
-- Invoice payments
invoice_payments AS (
    SELECT i.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
),
-- Retention release payments
retention_payments AS (
    SELECT r.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
),
-- Total vendor cash (all vendor-side payments combined for existing total_paid column)
vendor_cash AS (
    SELECT project_id, SUM(amount) AS total_paid
    FROM (
        SELECT project_id, amount FROM vendor_claim_payments
        UNION ALL
        SELECT project_id, amount FROM invoice_payments
        UNION ALL
        SELECT project_id, amount FROM retention_payments
    ) sub
    GROUP BY project_id
),
-- Employee expenses paid: expenses marked approved are the liability;
-- actual cash out is tracked via ledger_entries for employees.
-- We expose approved amount as "billed" and use the same as "paid" proxy
-- (employees are typically paid when approved). Adjust if you have a separate payment table.
expenses_paid_agg AS (
    SELECT project_id, SUM(amount) AS total_employee_expenses_paid
    FROM public.expenses
    WHERE status = 'approved'
      AND project_id IS NOT NULL
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

    -- ── Opening balance metadata ──────────────────────────────────────────────
    CASE WHEN ob.id IS NOT NULL THEN true ELSE false END  AS has_opening_balance,
    ob.cutoff_date                                         AS opening_cutoff_date,
    COALESCE(ob.prior_expenses,     0)                     AS prior_expenses,
    COALESCE(ob.prior_owner_income, 0)                     AS prior_owner_income,
    COALESCE(ob.prior_owner_dues,   0)                     AS prior_owner_dues,

    -- ── Vendor prior claims ───────────────────────────────────────────────────
    COALESCE(pvca.total_prior_certified,  0)               AS prior_vendor_certified,
    COALESCE(pvca.total_prior_paid,       0)               AS prior_vendor_paid,
    COALESCE(pvca.total_prior_retention,  0)               AS prior_vendor_retention,
    COALESCE(pvca.vendor_count,           0)               AS prior_vendor_count,

    -- ── Per-category expense breakdown (NEW) ──────────────────────────────────
    COALESCE(pca.vendor_billed, 0)                         AS vendor_claims_billed,
    COALESCE(vcp.amount, 0)                                AS vendor_claims_paid,

    COALESCE(ia.invoice_total, 0)                          AS invoices_billed,
    COALESCE(ip.amount, 0)                                 AS invoices_paid,

    COALESCE(ea.total_employee_expenses, 0)                AS employee_expenses_billed,
    COALESCE(epa.total_employee_expenses_paid, 0)          AS employee_expenses_paid,

    COALESCE(oc.total_received, 0)                         AS owner_paid,

    -- ── Combined figures (kept for backward compatibility) ────────────────────
    COALESCE(pca.owner_billed,  0)                         AS in_system_income,
    COALESCE(oc.total_received, 0)                         AS total_received,
    COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS in_system_expenses,
    COALESCE(vc.total_paid, 0)                             AS total_paid,
    COALESCE(pca.vendor_retained, 0)
      - COALESCE(rra.retention_released, 0)               AS retention_held,

    -- ── Inventory asset ───────────────────────────────────────────────────────
    COALESCE(ia_asset.total_asset_value, 0)                AS inventory_asset_value,

    -- ── Grand totals ──────────────────────────────────────────────────────────
    COALESCE(ob.prior_owner_dues,  0)
      + COALESCE(pca.owner_billed, 0)                      AS total_income,

    COALESCE(ob.prior_expenses, 0)
      + COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS total_expenses,

    -- balance
    COALESCE(ob.prior_owner_dues,  0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS balance,

    -- net_position (alias for homepage compatibility)
    COALESCE(ob.prior_owner_dues,  0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS net_position

FROM public.projects p
LEFT JOIN public.project_opening_balances   ob   ON ob.project_id   = p.id
LEFT JOIN proj_claims_agg                   pca  ON pca.project_id  = p.id
LEFT JOIN invoices_agg                      ia   ON ia.project_id   = p.id
LEFT JOIN expenses_agg                      ea   ON ea.project_id   = p.id
LEFT JOIN expenses_paid_agg                 epa  ON epa.project_id  = p.id
LEFT JOIN retention_releases_agg            rra  ON rra.project_id  = p.id
LEFT JOIN owner_cash                        oc   ON oc.project_id   = p.id
LEFT JOIN vendor_claim_payments             vcp  ON vcp.project_id  = p.id
LEFT JOIN invoice_payments                  ip   ON ip.project_id   = p.id
LEFT JOIN vendor_cash                       vc   ON vc.project_id   = p.id
LEFT JOIN prior_vendor_claims_agg           pvca ON pvca.project_id = p.id
LEFT JOIN inventory_asset                   ia_asset ON ia_asset.project_id = p.id;


-- ─────────────────────────────────────────────────────────────────────────────
-- Rebuild v_vendor_balances
-- Adds gross_total and total_retention_held columns, and correctly includes
-- prior_vendor_claims (Claim #0) in gross/retention/paid totals.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_vendor_balances CASCADE;

CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
WITH
-- Latest approved claim per vendor+project
latest_claims AS (
    SELECT DISTINCT ON (c.party_id, c.project_id)
        c.id          AS claim_id,
        c.party_id    AS vendor_id,
        c.project_id,
        c.tax_enabled,
        c.tax_rate
    FROM public.claims c
    WHERE c.claim_type = 'vendor'
      AND c.status = 'approved'
    ORDER BY c.party_id, c.project_id, c.claim_number DESC
),
-- Totals for each latest claim
claim_totals AS (
    SELECT
        lc.vendor_id,
        lc.project_id,
        lc.claim_id,
        COALESCE(vct.claim_cumulative_total,    0) AS gross_in_system,
        COALESCE(vct.claim_cumulative_retained, 0) AS retained_in_system
    FROM latest_claims lc
    JOIN public.v_claim_totals vct ON vct.claim_id = lc.claim_id
),
-- Payments across ALL approved claims per vendor+project
-- (payments may be allocated to any claim, not just the latest)
claim_paid AS (
    SELECT
        c.party_id                              AS vendor_id,
        c.project_id,
        COALESCE(SUM(vcp.paid_amount), 0)       AS paid_in_system
    FROM public.claims c
    JOIN public.v_claim_paid vcp ON vcp.claim_id = c.id
    WHERE c.claim_type = 'vendor'
      AND c.status     = 'approved'
    GROUP BY c.party_id, c.project_id
),
-- Prior (Claim #0) data per vendor+project
prior AS (
    SELECT
        vendor_id,
        project_id,
        COALESCE(prior_certified_amount, 0) AS prior_certified,
        COALESCE(prior_paid_amount,      0) AS prior_paid,
        COALESCE(prior_retention_held,   0) AS prior_retention
    FROM public.vendor_prior_claims
),
-- Aggregate per vendor (across all projects)
vendor_agg AS (
    SELECT
        ct.vendor_id,
        -- Gross = in-system gross + prior certified
        SUM(ct.gross_in_system + COALESCE(p.prior_certified, 0))           AS gross_total,
        -- Retention = in-system retained + prior retention
        SUM(ct.retained_in_system + COALESCE(p.prior_retention, 0))        AS total_retention_held,
        -- Net = gross - retention
        SUM(
            (ct.gross_in_system + COALESCE(p.prior_certified, 0))
          - (ct.retained_in_system + COALESCE(p.prior_retention, 0))
        )                                                                   AS total_due,
        -- Paid = in-system paid + prior paid
        SUM(COALESCE(cp.paid_in_system, 0) + COALESCE(p.prior_paid, 0))   AS total_paid
    FROM claim_totals ct
    LEFT JOIN prior       p  ON p.vendor_id  = ct.vendor_id  AND p.project_id  = ct.project_id
    LEFT JOIN claim_paid  cp ON cp.vendor_id = ct.vendor_id  AND cp.project_id = ct.project_id
    GROUP BY ct.vendor_id
),
-- Vendors with ONLY prior claims (no in-system claim yet)
prior_only AS (
    SELECT
        p.vendor_id,
        SUM(p.prior_certified)              AS gross_total,
        SUM(p.prior_retention)              AS total_retention_held,
        SUM(p.prior_certified - p.prior_retention) AS total_due,
        SUM(p.prior_paid)                   AS total_paid
    FROM prior p
    WHERE NOT EXISTS (
        SELECT 1 FROM claim_totals ct
        WHERE ct.vendor_id = p.vendor_id AND ct.project_id = p.project_id
    )
    GROUP BY p.vendor_id
),
-- Union both sets
all_agg AS (
    SELECT * FROM vendor_agg
    UNION ALL
    SELECT * FROM prior_only
),
combined AS (
    SELECT
        vendor_id,
        SUM(gross_total)           AS gross_total,
        SUM(total_retention_held)  AS total_retention_held,
        SUM(total_due)             AS total_due,
        SUM(total_paid)            AS total_paid,
        SUM(total_due) - SUM(total_paid) AS balance
    FROM all_agg
    GROUP BY vendor_id
)
SELECT
    v.id                                        AS vendor_id,
    v.name                                      AS vendor_name,
    COALESCE(c.gross_total,          0)         AS gross_total,
    COALESCE(c.total_retention_held, 0)         AS total_retention_held,
    COALESCE(c.total_due,            0)         AS total_due,
    COALESCE(c.total_paid,           0)         AS total_paid,
    COALESCE(c.balance,              0)         AS balance
FROM public.vendors v
LEFT JOIN combined c ON c.vendor_id = v.id
WHERE COALESCE(c.balance, 0) > 0    -- only show vendors with outstanding balance
   OR COALESCE(c.gross_total, 0) > 0; -- or any billed work


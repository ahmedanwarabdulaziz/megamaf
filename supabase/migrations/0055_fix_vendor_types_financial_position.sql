-- 0055_fix_vendor_types_financial_position.sql

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH
latest_vendor_claims AS (
    SELECT DISTINCT ON (c.party_id, c.project_id)
        c.project_id,
        vct.claim_cumulative_total    AS gross_in_system,
        vct.claim_cumulative_retained AS retained_in_system,
        vct.claim_cumulative_payable  AS payable_in_system,
        vct.total_due_this_claim
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status     = 'approved'
      AND c.claim_type = 'vendor'
    ORDER BY c.party_id, c.project_id, c.claim_number DESC
),
latest_owner_claims AS (
    SELECT DISTINCT ON (c.party_id, c.project_id)
        c.project_id,
        vct.claim_cumulative_total    AS gross_in_system,
        vct.claim_cumulative_retained AS retained_in_system,
        vct.claim_cumulative_payable  AS payable_in_system,
        vct.total_due_this_claim
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status     = 'approved'
      AND c.claim_type = 'owner'
    ORDER BY c.party_id, c.project_id, c.claim_number DESC
),
vendor_claims_agg AS (
    SELECT
        project_id,
        SUM(total_due_this_claim) AS vendor_billed,
        SUM(gross_in_system)      AS vendor_gross,
        SUM(retained_in_system)   AS vendor_retained,
        SUM(payable_in_system)    AS vendor_payable
    FROM latest_vendor_claims
    GROUP BY project_id
),
owner_claims_agg AS (
    SELECT
        project_id,
        SUM(total_due_this_claim) AS owner_billed,
        SUM(gross_in_system)    AS owner_gross,
        SUM(retained_in_system) AS owner_retained,
        SUM(payable_in_system)  AS owner_payable
    FROM latest_owner_claims
    GROUP BY project_id
),
owner_claims_tax AS (
    SELECT
        c.project_id,
        SUM(vct.tax_amount) AS total_tax
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
      AND c.claim_type = 'owner'
    GROUP BY c.project_id
),
vendor_claims_tax AS (
    SELECT
        c.project_id,
        SUM(vct.tax_amount) AS total_tax
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
      AND c.claim_type = 'vendor'
    GROUP BY c.project_id
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
expenses_paid_agg AS (
    SELECT project_id, SUM(amount) AS total_employee_expenses_paid
    FROM public.expenses
    WHERE status = 'approved'
      AND project_id IS NOT NULL
    GROUP BY project_id
),
contractor_payments AS (
    SELECT
        le.project_id,
        COALESCE(SUM(le.amount), 0) AS paid_in_system
    FROM public.ledger_entries le
    JOIN public.vendors v ON v.id = le.counterparty_id
    WHERE le.counterparty_type = 'vendor'
      AND le.direction = 'out'
      AND le.project_id IS NOT NULL
      AND v.kind = 'contractor'
    GROUP BY le.project_id
),
supplier_payments AS (
    SELECT
        le.project_id,
        COALESCE(SUM(le.amount), 0) AS paid_in_system
    FROM public.ledger_entries le
    JOIN public.vendors v ON v.id = le.counterparty_id
    WHERE le.counterparty_type = 'vendor'
      AND le.direction = 'out'
      AND le.project_id IS NOT NULL
      AND v.kind = 'supplier'
    GROUP BY le.project_id
),
vendor_claim_zero_paid AS (
    SELECT
        project_id,
        COALESCE(SUM(opening_paid_amount), 0) AS opening_paid
    FROM public.claims
    WHERE claim_type = 'vendor'
      AND claim_number = 0
      AND status = 'approved'
    GROUP BY project_id
),
owner_payments AS (
    SELECT
        project_id,
        COALESCE(SUM(amount), 0) AS paid_in_system
    FROM public.ledger_entries
    WHERE counterparty_type = 'owner'
      AND direction = 'in'
      AND project_id IS NOT NULL
    GROUP BY project_id
),
owner_claim_zero_paid AS (
    SELECT
        project_id,
        COALESCE(SUM(opening_paid_amount), 0) AS opening_paid
    FROM public.claims
    WHERE claim_type = 'owner'
      AND claim_number = 0
      AND status = 'approved'
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) AS retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
retention_release_payments AS (
    SELECT
        r.project_id,
        COALESCE(SUM(vrp.paid_amount), 0) AS paid
    FROM public.retention_releases r
    JOIN public.v_retention_paid vrp ON vrp.retention_id = r.id
    WHERE r.claim_type = 'vendor'
    GROUP BY r.project_id
),
prior_vendor_claims_agg AS (
    SELECT
        vpc.project_id,
        SUM(vpc.prior_certified_amount) AS total_prior_certified,
        SUM(vpc.prior_paid_amount)      AS total_prior_paid,
        SUM(vpc.prior_retention_held)   AS total_prior_retention
    FROM public.vendor_prior_claims vpc
    WHERE NOT EXISTS (
        SELECT 1 FROM public.claims c0
        WHERE c0.party_id = vpc.vendor_id
          AND c0.project_id = vpc.project_id
          AND c0.claim_type = 'vendor'
          AND c0.claim_number = 0
          AND c0.status = 'approved'
    )
    GROUP BY vpc.project_id
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
),
project_opening AS (
    SELECT
        ob.project_id,
        ob.cutoff_date,
        ob.prior_expenses,
        ob.prior_owner_income,
        ob.prior_owner_dues
    FROM public.project_opening_balances ob
    JOIN public.projects p ON p.id = ob.project_id
    WHERE NOT EXISTS (
        SELECT 1 FROM public.claims c
        WHERE c.party_id = p.owner_id
          AND c.project_id = ob.project_id
          AND c.claim_type = 'owner'
          AND c.claim_number = 0
          AND c.status = 'approved'
    )
)
SELECT
    p.id AS project_id,
    
    -- Incomes
    (
        COALESCE(oa.owner_billed, 0) +
        COALESCE(po.prior_owner_dues, 0)
    ) AS total_income,
    
    -- Expenses
    (
        COALESCE(va.vendor_billed, 0) +
        COALESCE(ia.invoice_total, 0) +
        COALESCE(ea.total_employee_expenses, 0) +
        COALESCE(pva.total_prior_certified, 0)
    ) AS total_expenses,
    
    -- Balance
    (
        (COALESCE(oa.owner_billed, 0) + COALESCE(po.prior_owner_dues, 0)) -
        (COALESCE(va.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) + COALESCE(ea.total_employee_expenses, 0) + COALESCE(pva.total_prior_certified, 0))
    ) AS balance,
    
    -- Retention
    (
        COALESCE(va.vendor_retained, 0) +
        COALESCE(pva.total_prior_retention, 0) -
        COALESCE(rra.retention_released, 0)
    ) AS current_retention_held,
    
    COALESCE(ia_asset.total_asset_value, 0) AS inventory_asset_value,
    
    CASE WHEN po.project_id IS NOT NULL THEN true ELSE false END AS has_opening_balance,
    po.cutoff_date AS opening_cutoff_date,
    COALESCE(po.prior_expenses, 0) AS prior_expenses,
    COALESCE(po.prior_owner_income, 0) AS prior_owner_income,
    COALESCE(po.prior_owner_dues, 0) AS prior_owner_dues,
    
    -- OWNER CASH IN
    (
        COALESCE(op.paid_in_system, 0) +
        COALESCE(po.prior_owner_income, 0) +
        COALESCE(ocz.opening_paid, 0)
    ) AS owner_total_collected,
    
    -- TOTAL VENDOR/OUT CASH
    (
        COALESCE(cp.paid_in_system, 0) +
        COALESCE(sp.paid_in_system, 0) +
        COALESCE(vcz.opening_paid, 0) +
        COALESCE(rp.paid, 0) +
        COALESCE(pva.total_prior_paid, 0)
    ) AS total_cash_paid,

    -- OWNER BREAKDOWN
    COALESCE(oa.owner_gross, 0) AS owner_claims_gross,
    COALESCE(oa.owner_retained, 0) AS owner_claims_retained,
    COALESCE(oa.owner_payable, 0) AS owner_claims_payable,
    COALESCE(oct.total_tax, 0) AS owner_claims_tax,

    -- VENDOR/EXPENSE BREAKDOWNS
    COALESCE(va.vendor_billed, 0)                         AS vendor_claims_billed,
    COALESCE(va.vendor_gross, 0)                          AS vendor_claims_gross,
    COALESCE(va.vendor_retained, 0)                       AS vendor_claims_retained,
    COALESCE(va.vendor_payable, 0)                        AS vendor_claims_payable,
    COALESCE(cp.paid_in_system, 0) + COALESCE(vcz.opening_paid, 0) AS vendor_claims_paid,
    COALESCE(vct.total_tax, 0)                            AS vendor_claims_tax,

    COALESCE(ia.invoice_total, 0)                         AS invoices_billed,
    COALESCE(sp.paid_in_system, 0)                        AS invoices_paid,

    COALESCE(ea.total_employee_expenses, 0)               AS employee_expenses_billed,
    COALESCE(epa.total_employee_expenses_paid, 0)         AS employee_expenses_paid,

    -- ALIASES FOR COMPATIBILITY
    (COALESCE(op.paid_in_system, 0) + COALESCE(po.prior_owner_income, 0) + COALESCE(ocz.opening_paid, 0)) AS owner_paid,
    COALESCE(pva.total_prior_certified, 0) AS prior_vendor_certified,
    COALESCE(pva.total_prior_retention, 0) AS prior_vendor_retention,
    COALESCE(pva.total_prior_paid, 0) AS prior_vendor_paid

FROM public.projects p
LEFT JOIN vendor_claims_agg va ON va.project_id = p.id
LEFT JOIN owner_claims_agg oa ON oa.project_id = p.id
LEFT JOIN owner_claims_tax oct ON oct.project_id = p.id
LEFT JOIN vendor_claims_tax vct ON vct.project_id = p.id
LEFT JOIN invoices_agg ia ON ia.project_id = p.id
LEFT JOIN expenses_agg ea ON ea.project_id = p.id
LEFT JOIN expenses_paid_agg epa ON epa.project_id = p.id
LEFT JOIN retention_releases_agg rra ON rra.project_id = p.id
LEFT JOIN contractor_payments cp ON cp.project_id = p.id
LEFT JOIN supplier_payments sp ON sp.project_id = p.id
LEFT JOIN vendor_claim_zero_paid vcz ON vcz.project_id = p.id
LEFT JOIN owner_payments op ON op.project_id = p.id
LEFT JOIN owner_claim_zero_paid ocz ON ocz.project_id = p.id
LEFT JOIN retention_release_payments rp ON rp.project_id = p.id
LEFT JOIN prior_vendor_claims_agg pva ON pva.project_id = p.id
LEFT JOIN inventory_asset ia_asset ON ia_asset.project_id = p.id
LEFT JOIN project_opening po ON po.project_id = p.id;

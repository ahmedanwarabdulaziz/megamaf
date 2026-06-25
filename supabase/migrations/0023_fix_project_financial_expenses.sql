-- 0023_fix_project_financial_expenses.sql
-- Add approved employee (and owner) expenses to v_project_financial_position.
-- Previously total_expenses only included vendor claims + invoices,
-- so approved employee expenses had no effect on the project balance.

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
        SUM(CASE WHEN claim_type = 'owner'  THEN total_due_this_claim    ELSE 0 END) AS owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim    ELSE 0 END) AS vendor_billed,
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
-- ► NEW: employee + owner expenses approved against a project
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
)
SELECT
    p.id   AS project_id,
    p.name,
    p.code,
    COALESCE(pca.owner_billed, 0)                                                               AS total_income,
    COALESCE(oc.total_received, 0)                                                              AS total_received,
    -- ► total_expenses now includes vendor claims + invoices + employee/owner expenses
    COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)                                                 AS total_expenses,
    COALESCE(vc.total_paid, 0)                                                                  AS total_paid,
    COALESCE(pca.vendor_retained, 0) - COALESCE(rra.retention_released, 0)                     AS retention_held,
    -- ► balance also deducts employee/owner expenses
    COALESCE(pca.owner_billed, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)                                                 AS balance
FROM public.projects p
LEFT JOIN proj_claims_agg       pca ON pca.project_id = p.id
LEFT JOIN invoices_agg           ia ON ia.project_id  = p.id
LEFT JOIN expenses_agg           ea ON ea.project_id  = p.id
LEFT JOIN retention_releases_agg rra ON rra.project_id = p.id
LEFT JOIN owner_cash             oc ON oc.project_id  = p.id
LEFT JOIN vendor_cash            vc ON vc.project_id  = p.id;

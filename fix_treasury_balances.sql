-- 1. Update v_vendor_account to include Opening Balances (Claim #0)
CREATE OR REPLACE VIEW public.v_vendor_account WITH (security_invoker = true) AS
WITH vendor_docs AS (
    -- Approved invoices
    SELECT
        i.vendor_id AS party_id, i.project_id,
        i.invoice_date AS document_date,
        'invoice' AS document_type, i.id AS document_id,
        ('فاتورة #' || i.id::text) AS description,
        i.total AS amount_due,
        COALESCE((SELECT vip.paid_amount FROM public.v_invoice_paid vip WHERE vip.invoice_id = i.id), 0) AS amount_paid,
        i.created_at
    FROM public.invoices i WHERE i.status = 'approved'

    UNION ALL

    -- Approved vendor claims
    SELECT
        c.party_id, c.project_id, c.claim_date AS document_date,
        'claim' AS document_type, c.id AS document_id,
        ('مستخلص مقاول رقم ' || c.claim_number::text) AS description,
        COALESCE((SELECT vct.total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id), 0) AS amount_due,
        0::numeric AS amount_paid, c.created_at
    FROM public.claims c
    WHERE c.status = 'approved' AND c.claim_type = 'vendor'

    UNION ALL

    -- Retention releases
    SELECT
        r.party_id, r.project_id, r.released_at::date AS document_date,
        'retention_release' AS document_type, r.id AS document_id,
        'إفراج ضمان حسن تنفيذ' AS description,
        r.amount AS amount_due,
        COALESCE((SELECT vrp.paid_amount FROM public.v_retention_paid vrp WHERE vrp.retention_id = r.id), 0) AS amount_paid,
        r.created_at
    FROM public.retention_releases r WHERE r.claim_type = 'vendor'

    UNION ALL

    -- Outgoing ledger payments
    SELECT
        le.counterparty_id AS party_id, le.project_id,
        le.entry_date AS document_date,
        'payment' AS document_type, le.id AS document_id,
        COALESCE(le.memo, 'دفعة للمقاول') AS description,
        0::numeric AS amount_due, le.amount AS amount_paid, le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'vendor' AND le.direction = 'out'

    UNION ALL

    -- ► NEW: Opening Balances (Claim #0) from vendor_prior_claims
    SELECT
        vpc.vendor_id AS party_id, vpc.project_id,
        vpc.created_at::date AS document_date,
        'pre_system_payment' AS document_type, vpc.id AS document_id,
        'الرصيد الافتتاحي (مستخلص #0)' AS description,
        -- The opening amount due is the net certified amount (certified minus retention)
        GREATEST(COALESCE(vpc.prior_certified_amount, 0) - COALESCE(vpc.prior_retention_held, 0), 0) AS amount_due,
        -- The opening paid amount is what was already paid before the system
        COALESCE(vpc.prior_paid_amount, 0) AS amount_paid,
        vpc.created_at
    FROM public.vendor_prior_claims vpc
)
SELECT
    d.party_id, d.project_id,
    p.name AS project_name,
    d.document_date, d.document_type, d.document_id,
    d.description, d.amount_due, d.amount_paid, d.created_at,
    SUM(d.amount_due - d.amount_paid) OVER (
        PARTITION BY d.party_id
        ORDER BY d.document_date ASC, d.created_at ASC
    ) AS running_balance
FROM vendor_docs d
LEFT JOIN public.projects p ON p.id = d.project_id;


-- 2. Update v_vendor_balances to calculate totals correctly, including retention
CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
WITH retention_totals AS (
    SELECT
        c.party_id,
        SUM(COALESCE(ct.claim_cumulative_retained, 0)) AS in_system_retention
    FROM public.claims c
    JOIN public.v_claim_totals ct ON ct.claim_id = c.id
    WHERE c.status = 'approved' AND c.claim_type = 'vendor'
    GROUP BY c.party_id
),
prior_retention AS (
    SELECT vendor_id, SUM(COALESCE(prior_retention_held, 0)) AS pre_system_retention
    FROM public.vendor_prior_claims
    GROUP BY vendor_id
)
SELECT
    v.id                                                                    AS vendor_id,
    v.name                                                                  AS vendor_name,
    COALESCE(SUM(va.amount_due),  0)                                       AS total_due,
    COALESCE(SUM(va.amount_paid), 0)                                       AS total_paid,
    COALESCE(SUM(va.amount_due) - SUM(va.amount_paid), 0)                 AS balance,
    COALESCE(rt.in_system_retention, 0) + COALESCE(pr.pre_system_retention, 0)  AS total_retention_held
FROM public.vendors v
LEFT JOIN public.v_vendor_account va ON va.party_id = v.id
LEFT JOIN retention_totals rt ON rt.party_id = v.id
LEFT JOIN prior_retention pr ON pr.vendor_id = v.id
GROUP BY v.id, v.name, rt.in_system_retention, pr.pre_system_retention;

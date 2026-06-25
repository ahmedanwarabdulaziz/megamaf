-- 0029_recreate_owner_vendor_account_views.sql
-- 
-- Migration 0026 used DROP VIEW ... CASCADE on v_claim_totals which silently
-- dropped v_owner_account, v_vendor_account, v_owner_balances, v_vendor_balances
-- (all depended on v_claim_totals via correlated subqueries).
-- This migration recreates all four views.

-- ─── 1. v_owner_account ───────────────────────────────────────────────────────
-- Shows per-document rows for an owner: approved claims (what is owed)
-- and ledger receipts (what has been collected).
-- amount_due  = total_due_this_claim from v_claim_totals (already net of allocations)
-- amount_paid = 0 on claim rows; receipt amount on receipt rows
-- running_balance = cumulative net (amount_due - amount_paid)

CREATE OR REPLACE VIEW public.v_owner_account WITH (security_invoker = true) AS
WITH owner_docs AS (

    -- ► Approved owner claims (what the owner owes us)
    SELECT
        c.party_id,
        c.project_id,
        c.claim_date                                                                AS document_date,
        'claim'                                                                     AS document_type,
        c.id                                                                        AS document_id,
        ('مستخلص مالك رقم ' || c.claim_number::text)                               AS description,
        COALESCE(
            (SELECT vct.total_due_this_claim
               FROM public.v_claim_totals vct
              WHERE vct.claim_id = c.id),
            0
        )                                                                           AS amount_due,
        0::numeric                                                                  AS amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved'
      AND c.claim_type = 'owner'

    UNION ALL

    -- ► Ledger receipts (payments collected from the owner)
    SELECT
        le.counterparty_id                                                          AS party_id,
        le.project_id,
        le.entry_date                                                               AS document_date,
        'receipt'                                                                   AS document_type,
        le.id                                                                       AS document_id,
        COALESCE(le.memo, 'تحصيل دفعة')                                            AS description,
        0::numeric                                                                  AS amount_due,
        le.amount                                                                   AS amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'owner'
      AND le.direction          = 'in'
)
SELECT
    d.party_id,
    d.project_id,
    p.name                                                                          AS project_name,
    d.document_date,
    d.document_type,
    d.document_id,
    d.description,
    d.amount_due,
    d.amount_paid,
    d.created_at,
    SUM(d.amount_due - d.amount_paid) OVER (
        PARTITION BY d.party_id
        ORDER BY d.document_date ASC, d.created_at ASC
    )                                                                               AS running_balance
FROM owner_docs d
LEFT JOIN public.projects p ON p.id = d.project_id;


-- ─── 2. v_vendor_account ─────────────────────────────────────────────────────
-- Same structure for the vendor side: invoices + vendor claims + retention
-- releases (what we owe vendors) and outgoing ledger payments.

CREATE OR REPLACE VIEW public.v_vendor_account WITH (security_invoker = true) AS
WITH vendor_docs AS (

    -- ► Approved invoices
    SELECT
        i.vendor_id                                                                 AS party_id,
        i.project_id,
        i.invoice_date                                                              AS document_date,
        'invoice'                                                                   AS document_type,
        i.id                                                                        AS document_id,
        ('فاتورة #' || i.id::text)                                                  AS description,
        i.total                                                                     AS amount_due,
        COALESCE(
            (SELECT vip.paid_amount
               FROM public.v_invoice_paid vip
              WHERE vip.invoice_id = i.id),
            0
        )                                                                           AS amount_paid,
        i.created_at
    FROM public.invoices i
    WHERE i.status = 'approved'

    UNION ALL

    -- ► Approved vendor claims
    SELECT
        c.party_id,
        c.project_id,
        c.claim_date                                                                AS document_date,
        'claim'                                                                     AS document_type,
        c.id                                                                        AS document_id,
        ('مستخلص مقاول رقم ' || c.claim_number::text)                              AS description,
        COALESCE(
            (SELECT vct.total_due_this_claim
               FROM public.v_claim_totals vct
              WHERE vct.claim_id = c.id),
            0
        )                                                                           AS amount_due,
        0::numeric                                                                  AS amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved'
      AND c.claim_type = 'vendor'

    UNION ALL

    -- ► Retention releases
    SELECT
        r.party_id,
        r.project_id,
        r.released_at::date                                                         AS document_date,
        'retention_release'                                                         AS document_type,
        r.id                                                                        AS document_id,
        'إفراج ضمان حسن تنفيذ'                                                      AS description,
        r.amount                                                                    AS amount_due,
        COALESCE(
            (SELECT vrp.paid_amount
               FROM public.v_retention_paid vrp
              WHERE vrp.retention_id = r.id),
            0
        )                                                                           AS amount_paid,
        r.created_at
    FROM public.retention_releases r
    WHERE r.claim_type = 'vendor'

    UNION ALL

    -- ► Outgoing ledger payments to vendors
    SELECT
        le.counterparty_id                                                          AS party_id,
        le.project_id,
        le.entry_date                                                               AS document_date,
        'payment'                                                                   AS document_type,
        le.id                                                                       AS document_id,
        COALESCE(le.memo, 'دفعة للمقاول')                                           AS description,
        0::numeric                                                                  AS amount_due,
        le.amount                                                                   AS amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'vendor'
      AND le.direction          = 'out'
)
SELECT
    d.party_id,
    d.project_id,
    p.name                                                                          AS project_name,
    d.document_date,
    d.document_type,
    d.document_id,
    d.description,
    d.amount_due,
    d.amount_paid,
    d.created_at,
    SUM(d.amount_due - d.amount_paid) OVER (
        PARTITION BY d.party_id
        ORDER BY d.document_date ASC, d.created_at ASC
    )                                                                               AS running_balance
FROM vendor_docs d
LEFT JOIN public.projects p ON p.id = d.project_id;


-- ─── 3. v_owner_balances ─────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_owner_balances WITH (security_invoker = true) AS
SELECT
    o.id                                                                            AS owner_id,
    o.name                                                                          AS owner_name,
    COALESCE(SUM(oa.amount_due),  0)                                               AS total_due,
    COALESCE(SUM(oa.amount_paid), 0)                                               AS total_paid,
    COALESCE(SUM(oa.amount_due) - SUM(oa.amount_paid), 0)                         AS balance
FROM public.project_owners o
LEFT JOIN public.v_owner_account oa ON oa.party_id = o.id
GROUP BY o.id, o.name;


-- ─── 4. v_vendor_balances ─────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
SELECT
    v.id                                                                            AS vendor_id,
    v.name                                                                          AS vendor_name,
    COALESCE(SUM(va.amount_due),  0)                                               AS total_due,
    COALESCE(SUM(va.amount_paid), 0)                                               AS total_paid,
    COALESCE(SUM(va.amount_due) - SUM(va.amount_paid), 0)                         AS balance
FROM public.vendors v
LEFT JOIN public.v_vendor_account va ON va.party_id = v.id
GROUP BY v.id, v.name;

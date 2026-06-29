-- 0039_vendor_account_prior_claims.sql
--
-- v_vendor_account was missing vendor_prior_claims (Claim #0 opening balances).
-- Vendors who only have a prior claim (no in-system approved claims) were showing
-- balance = 0 and were invisible in the treasury payables tab.
--
-- Fix:
--   1. Rebuild v_vendor_account with a new UNION ALL branch for vendor_prior_claims
--      (prior_certified_amount → amount_due, prior_paid_amount → amount_paid)
--   2. Rebuild v_vendor_balances to also expose total_retention_held

-- ─── 1. v_vendor_account (with prior claims) ───────────────────────────────

CREATE OR REPLACE VIEW public.v_vendor_account WITH (security_invoker = true) AS
WITH vendor_docs AS (

    -- ► Claim #0 — Pre-system opening balance (vendor_prior_claims)
    SELECT
        vpc.vendor_id                                                               AS party_id,
        vpc.project_id,
        vpc.cutoff_date                                                             AS document_date,
        'prior_claim'                                                               AS document_type,
        vpc.id                                                                      AS document_id,
        'مستخلص #0 (رصيد افتتاحي قبل النظام)'                                      AS description,
        vpc.prior_certified_amount                                                  AS amount_due,
        vpc.prior_paid_amount                                                       AS amount_paid,
        vpc.created_at
    FROM public.vendor_prior_claims vpc

    UNION ALL

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

    -- ► Approved vendor claims (in-system)
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


-- ─── 2. v_vendor_balances (with total_retention_held) ──────────────────────

CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
WITH retention_agg AS (
    -- Sum retention held across all approved claims per vendor
    SELECT
        c.party_id                                      AS vendor_id,
        COALESCE(SUM(vct.claim_cumulative_retained), 0) AS total_retention_held
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
      AND c.claim_type = 'vendor'
    GROUP BY c.party_id
)
SELECT
    v.id                                                                            AS vendor_id,
    v.name                                                                          AS vendor_name,
    COALESCE(SUM(va.amount_due),  0)                                               AS total_due,
    COALESCE(SUM(va.amount_paid), 0)                                               AS total_paid,
    COALESCE(SUM(va.amount_due) - SUM(va.amount_paid), 0)                         AS balance,
    COALESCE(ra.total_retention_held, 0)                                           AS total_retention_held
FROM public.vendors v
LEFT JOIN public.v_vendor_account va ON va.party_id = v.id
LEFT JOIN retention_agg ra ON ra.vendor_id = v.id
GROUP BY v.id, v.name, ra.total_retention_held;

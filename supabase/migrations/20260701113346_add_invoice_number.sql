ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_number SERIAL;

CREATE OR REPLACE VIEW public.v_vendor_account WITH (security_invoker = true) AS
WITH vendor_docs AS (
    -- Claim #0 — Pre-system opening balance (vendor_prior_claims fallback)
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
    WHERE NOT EXISTS (
        SELECT 1 FROM public.claims c
        WHERE c.party_id = vpc.vendor_id
          AND c.project_id = vpc.project_id
          AND c.claim_type = 'vendor'
          AND c.claim_number = 0
          AND c.status = 'approved'
    )

    UNION ALL

    -- Approved invoices
    SELECT
        i.vendor_id                                                                 AS party_id,
        i.project_id,
        i.invoice_date                                                              AS document_date,
        'invoice'                                                                   AS document_type,
        i.id                                                                        AS document_id,
        ('فاتورة رقم ' || i.invoice_number::text)                                     AS description,
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

    -- Approved vendor claims (in-system)
    SELECT
        c.party_id,
        c.project_id,
        c.claim_date                                                                AS document_date,
        CASE WHEN c.claim_number = 0 THEN 'prior_claim' ELSE 'claim' END            AS document_type,
        c.id                                                                        AS document_id,
        CASE WHEN c.claim_number = 0
             THEN 'مستخلص #0 (رصيد افتتاحي قبل النظام)'
             ELSE ('مستخلص مقاول رقم ' || c.claim_number::text)
        END                                                                         AS description,
        COALESCE(
            (SELECT vct.total_due_this_claim
               FROM public.v_claim_totals vct
              WHERE vct.claim_id = c.id),
            0
        )                                                                           AS amount_due,
        CASE WHEN c.claim_number = 0 THEN c.opening_paid_amount ELSE 0::numeric END AS amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved'
      AND c.claim_type = 'vendor'

    UNION ALL

    -- Retention releases
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

    -- Outgoing ledger payments to vendors
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
    WHERE le.counterparty_type = 'vendor' AND le.direction = 'out'
)
SELECT
    party_id,
    project_id,
    document_date,
    document_type,
    document_id,
    description,
    amount_due,
    amount_paid,
    (amount_due - amount_paid) AS balance,
    created_at
FROM vendor_docs
ORDER BY document_date ASC;

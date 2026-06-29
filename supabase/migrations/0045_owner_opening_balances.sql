-- 0045_owner_opening_balances.sql

DROP VIEW IF EXISTS public.v_owner_balances CASCADE;
DROP VIEW IF EXISTS public.v_owner_account CASCADE;

CREATE OR REPLACE VIEW public.v_owner_account WITH (security_invoker = true) AS
WITH owner_docs AS (
    -- 1. Approved owner claims (what the owner owes us)
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

    -- 2. Ledger receipts (payments collected from the owner)
    SELECT
        le.counterparty_id                                                          AS party_id,
        le.project_id,
        le.entry_date                                                               AS document_date,
        'receipt'                                                                   AS document_type,
        le.id                                                                       AS document_id,
        COALESCE(le.memo, 'قبض من مالك')                                            AS description,
        0::numeric                                                                  AS amount_due,
        le.amount                                                                   AS amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'owner'
      AND le.direction          = 'in'

    UNION ALL

    -- 3. Project Opening Balances (prior_owner_income)
    SELECT
        p.owner_id                                                                  AS party_id,
        ob.project_id,
        ob.cutoff_date                                                              AS document_date,
        'opening_balance'                                                           AS document_type,
        ob.id                                                                       AS document_id,
        'رصيد افتتاحي للمشروع'                                                       AS description,
        ob.prior_owner_income                                                       AS amount_due,
        0::numeric                                                                  AS amount_paid,
        ob.created_at
    FROM public.project_opening_balances ob
    JOIN public.projects p ON p.id = ob.project_id
    WHERE ob.prior_owner_income > 0
      AND p.owner_id IS NOT NULL
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

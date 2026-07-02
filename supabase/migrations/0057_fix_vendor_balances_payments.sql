-- 0057_fix_vendor_balances_payments.sql
CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
WITH
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
claim_totals AS (
    SELECT
        lc.vendor_id,
        lc.project_id,
        COALESCE(vct.claim_cumulative_total,    0) AS gross_in_system,
        COALESCE(vct.claim_cumulative_retained, 0) AS retained_in_system
    FROM latest_claims lc
    JOIN public.v_claim_totals vct ON vct.claim_id = lc.claim_id
),
claim_zero_paid AS (
    SELECT
        c.party_id    AS vendor_id,
        c.project_id,
        COALESCE(SUM(c.opening_paid_amount), 0) AS opening_paid
    FROM public.claims c
    WHERE c.claim_type = 'vendor'
      AND c.claim_number = 0
      AND c.status = 'approved'
    GROUP BY c.party_id, c.project_id
),
ledger_paid AS (
    SELECT
        counterparty_id AS vendor_id,
        project_id,
        COALESCE(SUM(amount), 0) AS ledger_paid
    FROM public.ledger_entries
    WHERE counterparty_type = 'vendor'
      AND direction = 'out'
    GROUP BY counterparty_id, project_id
),
claim_paid AS (
    SELECT
        v.id AS vendor_id,
        p.id AS project_id,
        (COALESCE(lp.ledger_paid, 0) + COALESCE(czp.opening_paid, 0)) AS paid_in_system
    FROM public.vendors v
    CROSS JOIN public.projects p
    LEFT JOIN ledger_paid lp ON lp.vendor_id = v.id AND lp.project_id = p.id
    LEFT JOIN claim_zero_paid czp ON czp.vendor_id = v.id AND czp.project_id = p.id
    WHERE (COALESCE(lp.ledger_paid, 0) + COALESCE(czp.opening_paid, 0)) > 0
),
prior AS (
    SELECT
        vendor_id,
        project_id,
        COALESCE(prior_certified_amount, 0) AS prior_certified,
        COALESCE(prior_paid_amount,      0) AS prior_paid,
        COALESCE(prior_retention_held,   0) AS prior_retention
    FROM public.vendor_prior_claims
),
vendor_agg AS (
    SELECT
        ct.vendor_id,
        SUM(ct.gross_in_system     + COALESCE(p.prior_certified, 0))                    AS gross_total,
        SUM(ct.retained_in_system  + COALESCE(p.prior_retention, 0))                    AS total_retention_held,
        SUM((ct.gross_in_system    + COALESCE(p.prior_certified, 0))
          - (ct.retained_in_system + COALESCE(p.prior_retention, 0)))                   AS total_due,
        SUM(COALESCE(cp.paid_in_system, 0) + COALESCE(p.prior_paid, 0))                AS total_paid
    FROM claim_totals ct
    LEFT JOIN prior p  ON p.vendor_id  = ct.vendor_id  AND p.project_id  = ct.project_id
        AND NOT EXISTS (
            SELECT 1 FROM public.claims c0
            WHERE c0.party_id = ct.vendor_id
              AND c0.project_id = ct.project_id
              AND c0.claim_type = 'vendor'
              AND c0.claim_number = 0
              AND c0.status = 'approved'
        )
    LEFT JOIN claim_paid cp ON cp.vendor_id = ct.vendor_id  AND cp.project_id = ct.project_id
    GROUP BY ct.vendor_id
),
prior_only AS (
    SELECT
        p.vendor_id,
        SUM(p.prior_certified)                      AS gross_total,
        SUM(p.prior_retention)                      AS total_retention_held,
        SUM(p.prior_certified - p.prior_retention)  AS total_due,
        SUM(p.prior_paid)                           AS total_paid
    FROM prior p
    WHERE NOT EXISTS (
        SELECT 1 FROM latest_claims lc
        WHERE lc.vendor_id = p.vendor_id
          AND lc.project_id = p.project_id
    )
    GROUP BY p.vendor_id
),
combined AS (
    SELECT * FROM vendor_agg
    UNION ALL
    SELECT * FROM prior_only
),
final_agg AS (
    SELECT
        vendor_id,
        SUM(gross_total)          AS gross_total,
        SUM(total_retention_held) AS total_retention_held,
        SUM(total_due)            AS total_due,
        SUM(total_paid)           AS total_paid
    FROM combined
    GROUP BY vendor_id
)
SELECT
    v.id                                                  AS vendor_id,
    v.name                                                AS vendor_name,
    COALESCE(fa.gross_total, 0)                           AS gross_total,
    COALESCE(fa.total_due, 0)                             AS total_due,
    COALESCE(fa.total_paid, 0)                            AS total_paid,
    COALESCE(fa.total_due, 0) - COALESCE(fa.total_paid, 0) AS balance,
    COALESCE(fa.total_retention_held, 0)                  AS total_retention_held
FROM public.vendors v
JOIN final_agg fa ON fa.vendor_id = v.id;

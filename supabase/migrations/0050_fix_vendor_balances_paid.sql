-- =============================================================================
-- Migration 0050: Fix v_vendor_balances — sum paid across ALL claims per project
--
-- Problem: The old view joined v_claim_paid only for the LATEST claim per project.
-- Payments made against older claims (e.g. Claim #1) were invisible when
-- Claim #2 was the latest, causing المدفوع to show 0 instead of the correct total.
--
-- Fix: The new claim_paid CTE aggregates paid_amount across every approved claim
-- for the same vendor+project.
-- =============================================================================

DROP VIEW IF EXISTS public.v_vendor_balances CASCADE;

CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
WITH
-- Latest approved claim per vendor+project (for gross/retained totals)
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
-- Gross / retention from latest claim (cumulative totals already include all prior work)
claim_totals AS (
    SELECT
        lc.vendor_id,
        lc.project_id,
        COALESCE(vct.claim_cumulative_total,    0) AS gross_in_system,
        COALESCE(vct.claim_cumulative_retained, 0) AS retained_in_system
    FROM latest_claims lc
    JOIN public.v_claim_totals vct ON vct.claim_id = lc.claim_id
),
-- *** KEY FIX: sum paid_amount across ALL approved claims per vendor+project ***
-- Payments may have been allocated against any claim number, not just the latest.
claim_paid AS (
    SELECT
        c.party_id                          AS vendor_id,
        c.project_id,
        COALESCE(SUM(vcp.paid_amount), 0)   AS paid_in_system
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
-- Aggregate per vendor across all projects
vendor_agg AS (
    SELECT
        ct.vendor_id,
        SUM(ct.gross_in_system     + COALESCE(p.prior_certified, 0))                    AS gross_total,
        SUM(ct.retained_in_system  + COALESCE(p.prior_retention, 0))                    AS total_retention_held,
        SUM((ct.gross_in_system    + COALESCE(p.prior_certified, 0))
          - (ct.retained_in_system + COALESCE(p.prior_retention, 0)))                   AS total_due,
        SUM(COALESCE(cp.paid_in_system, 0) + COALESCE(p.prior_paid, 0))                AS total_paid
    FROM claim_totals ct
    LEFT JOIN prior      p  ON p.vendor_id  = ct.vendor_id  AND p.project_id  = ct.project_id
    LEFT JOIN claim_paid cp ON cp.vendor_id = ct.vendor_id  AND cp.project_id = ct.project_id
    GROUP BY ct.vendor_id
),
-- Vendors with ONLY prior claims (no in-system claim yet)
prior_only AS (
    SELECT
        p.vendor_id,
        SUM(p.prior_certified)                      AS gross_total,
        SUM(p.prior_retention)                      AS total_retention_held,
        SUM(p.prior_certified - p.prior_retention)  AS total_due,
        SUM(p.prior_paid)                           AS total_paid
    FROM prior p
    WHERE NOT EXISTS (
        SELECT 1 FROM claim_totals ct
        WHERE ct.vendor_id = p.vendor_id AND ct.project_id = p.project_id
    )
    GROUP BY p.vendor_id
),
all_agg AS (
    SELECT * FROM vendor_agg
    UNION ALL
    SELECT * FROM prior_only
),
combined AS (
    SELECT
        vendor_id,
        SUM(gross_total)          AS gross_total,
        SUM(total_retention_held) AS total_retention_held,
        SUM(total_due)            AS total_due,
        SUM(total_paid)           AS total_paid,
        SUM(total_due) - SUM(total_paid) AS balance
    FROM all_agg
    GROUP BY vendor_id
)
SELECT
    v.id                                  AS vendor_id,
    v.name                                AS vendor_name,
    COALESCE(c.gross_total,          0)   AS gross_total,
    COALESCE(c.total_retention_held, 0)   AS total_retention_held,
    COALESCE(c.total_due,            0)   AS total_due,
    COALESCE(c.total_paid,           0)   AS total_paid,
    COALESCE(c.balance,              0)   AS balance
FROM public.vendors v
LEFT JOIN combined c ON c.vendor_id = v.id
WHERE COALESCE(c.balance,     0) > 0
   OR COALESCE(c.gross_total, 0) > 0;

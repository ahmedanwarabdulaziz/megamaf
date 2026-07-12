-- 20260712130000_fix_v_claim_paid_claim_zero.sql
--
-- On this database, v_claim_paid currently returns ONLY opening_paid_amount for
-- claim #0 rows, completely ignoring any real payment_allocations against them
-- (confirmed empirically: allocating 25,000 + 0.01 to a claim#0 left v_claim_paid
-- frozen at its opening_paid_amount). This isn't just a display bug — it's what
-- record_vendor_payment(_from_expense) uses to validate "does this allocation
-- exceed the remaining due?", so claim#0 documents could be paid past their true
-- remaining balance indefinitely without the check ever noticing.
--
-- Fix: paid_amount for claim#0 must be the SUM of both sources, not either/or.

CREATE OR REPLACE VIEW public.v_claim_paid WITH (security_invoker = true) AS
SELECT
    c.id AS claim_id,
    COALESCE(SUM(pa.allocated_amount), 0)
        + CASE WHEN c.claim_number = 0 THEN COALESCE(c.opening_paid_amount, 0) ELSE 0 END AS paid_amount
FROM public.claims c
LEFT JOIN public.payment_allocations pa ON pa.target_id = c.id AND pa.target_type = 'claim'
GROUP BY c.id, c.claim_number, c.opening_paid_amount;

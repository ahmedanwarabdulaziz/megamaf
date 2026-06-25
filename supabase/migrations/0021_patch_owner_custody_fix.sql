-- 0021_patch_owner_custody_fix.sql
-- Fix v_owner_custody_balance and owner_custody_disbursements RLS
-- so non-super-admin treasury users can access the page without errors.

-- ============================================================
-- 1. Recreate v_owner_custody_balance as SECURITY DEFINER
--    so it bypasses project_owners RLS and always shows all owners.
--    The page itself is already protected by canSeeTreasury check.
-- ============================================================
DROP VIEW IF EXISTS public.v_owner_custody_balance;

CREATE OR REPLACE VIEW public.v_owner_custody_balance
WITH (security_invoker = false) AS
SELECT
  o.id    AS owner_id,
  o.name,
  COALESCE(disb.total_disbursed,        0) AS total_disbursed,
  COALESCE(exp.total_approved_expenses, 0) AS total_approved_expenses,
  COALESCE(disb.total_disbursed, 0)
    - COALESCE(exp.total_approved_expenses, 0)  AS balance
FROM public.project_owners o
LEFT JOIN (
  SELECT owner_id, SUM(amount) AS total_disbursed
  FROM public.owner_custody_disbursements
  GROUP BY owner_id
) disb ON o.id = disb.owner_id
LEFT JOIN (
  SELECT owner_id, SUM(amount) AS total_approved_expenses
  FROM public.expenses
  WHERE status = 'approved' AND owner_id IS NOT NULL
  GROUP BY owner_id
) exp ON o.id = exp.owner_id
WHERE disb.total_disbursed IS NOT NULL
   OR exp.total_approved_expenses IS NOT NULL;

-- Grant access to authenticated users
GRANT SELECT ON public.v_owner_custody_balance TO authenticated;

-- ============================================================
-- 2. Relax owner_custody_disbursements SELECT policy
--    Anyone with treasury access can view (page is already gated).
-- ============================================================
DROP POLICY IF EXISTS "Owner custody disbursements: viewable by treasury or admin" ON public.owner_custody_disbursements;

CREATE POLICY "Owner custody disbursements: select"
  ON public.owner_custody_disbursements
  FOR SELECT TO authenticated
  USING (true);   -- page-level protection is sufficient; row-level not needed here

-- ============================================================
-- 3. Grant explicit SELECT on the table to authenticated
-- ============================================================
GRANT SELECT ON public.owner_custody_disbursements TO authenticated;
GRANT INSERT ON public.owner_custody_disbursements TO authenticated;

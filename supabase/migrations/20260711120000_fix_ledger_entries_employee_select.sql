-- 20260711120000_fix_ledger_entries_employee_select.sql
--
-- Bug: "إجمالي العهد المستلمة" on /expenses always showed 0 (or too low) for
-- regular employees. v_employee_custody_balance sums ledger_entries where
-- category = 'custody_disbursement' AND direction = 'in', filtered by the
-- querying user's RLS (the view is security_invoker = true). The 'in' row
-- created by disburse_custody() sets employee_id but leaves bank_account_id
-- and project_id NULL, so the "Ledger scoped select" policy from
-- 0005_phase3_hardening.sql never matched it for non-admins without
-- 'banks' page access, hiding their own custody disbursement rows.
--
-- Fix: let an employee see ledger_entries rows scoped to themselves.

DROP POLICY IF EXISTS "Ledger scoped select" ON public.ledger_entries;

CREATE POLICY "Ledger scoped select" ON public.ledger_entries
    FOR SELECT TO authenticated
    USING (
        public.is_super_admin()
        OR (bank_account_id IS NOT NULL AND public.has_page_access('banks'))
        OR (project_id IS NOT NULL AND public.has_project_access(project_id))
        OR employee_id = public.current_employee_id()
    );

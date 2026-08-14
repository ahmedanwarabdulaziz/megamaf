-- 20260814160000_fix_expense_funding_rls_super_admin.sql
--
-- Bug fix: the "Expenses insertable" INSERT policy added in
-- 20260814150000_expense_funding_source.sql guards funding_type with
-- has_expense_funding_access only, with no is_super_admin() bypass —
-- inconsistent with every other check in this app (and with
-- lib/actions/expenses.ts's createExpense, which already allows
-- is_super_admin to set funding_type regardless of the flag). Result: a
-- super admin without the flag explicitly granted passed the app-layer
-- check but was then rejected by RLS on the actual insert ("new row
-- violates row-level security policy for table expenses").

DROP POLICY IF EXISTS "Expenses insertable" ON public.expenses;

CREATE POLICY "Expenses insertable" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    disbursement_ledger_entry_id IS NULL
    AND funding_mirror_expense_id IS NULL
    AND (
      funding_type IS NULL
      OR public.is_super_admin()
      OR (
        employee_id = public.current_employee_id()
        AND (SELECT has_expense_funding_access FROM public.employees WHERE id = public.current_employee_id())
      )
    )
    AND (
      (
        employee_id IS NOT NULL
        AND employee_id = public.current_employee_id()
        AND (
          (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
          OR (SELECT has_expense_funding_access FROM public.employees WHERE id = public.current_employee_id())
        )
      )
      OR
      (
        employee_id IS NOT NULL
        AND owner_id IS NULL
        AND public.is_super_admin()
      )
      OR
      (
        owner_id IS NOT NULL
        AND employee_id IS NULL
        AND (
          (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
          OR public.is_super_admin()
        )
      )
    )
  );

-- 0022_patch_expense_admin_insert.sql
-- Allow super admins to insert expenses on behalf of any employee
-- (previously only allowed self-insert with has_custody_access)

DROP POLICY IF EXISTS "Expenses insertable" ON public.expenses;

CREATE POLICY "Expenses insertable"
  ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    -- (1) Employee submitting their own expense (must have custody access)
    (
      employee_id IS NOT NULL
      AND employee_id = public.current_employee_id()
      AND (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
    )
    OR
    -- (2) Super admin submitting on behalf of ANY employee
    (
      employee_id IS NOT NULL
      AND owner_id IS NULL
      AND public.is_super_admin()
    )
    OR
    -- (3) Admin/approver creating an expense on behalf of an owner
    (
      owner_id IS NOT NULL
      AND employee_id IS NULL
      AND (
        (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
        OR public.is_super_admin()
      )
    )
  );

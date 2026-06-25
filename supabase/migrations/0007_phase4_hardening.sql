-- 0007_phase4_hardening.sql

-- FIX 1: Enforce project access on expense create
DROP POLICY IF EXISTS "Expenses insertable by self if custody access" ON public.expenses;
CREATE POLICY "Expenses insert scoped" ON public.expenses
  FOR INSERT TO authenticated WITH CHECK (
    employee_id = public.current_employee_id()
    AND (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
    AND public.has_project_access(project_id)
  );

-- FIX 2: Scope approver expense visibility to granted projects
DROP POLICY IF EXISTS "Expenses viewable by creator or approvers" ON public.expenses;
CREATE POLICY "Expenses select scoped" ON public.expenses
  FOR SELECT TO authenticated USING (
    employee_id = public.current_employee_id()
    OR public.is_super_admin()
    OR (
      (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
      AND public.has_project_access(project_id)
    )
  );

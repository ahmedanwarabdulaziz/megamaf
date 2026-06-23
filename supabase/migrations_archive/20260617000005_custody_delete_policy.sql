-- Allow any company member to delete custodies (not just admins).
-- Individual permission checks (approved status, ownership) are done in the server action.
DROP POLICY IF EXISTS "Admins can delete custodies in their company" ON public.employee_custodies;

CREATE POLICY "Users can delete custodies in their company"
  ON public.employee_custodies FOR DELETE
  USING (company_id = get_my_company_id());

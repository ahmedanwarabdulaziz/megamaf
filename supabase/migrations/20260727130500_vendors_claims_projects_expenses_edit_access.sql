-- 20260727130500_vendors_claims_projects_expenses_edit_access.sql
--
-- Per user decision: for modules where writes are currently gated by
-- can_approve / has_project_access (not by page slug at all — vendors,
-- claims, retention, owner payment schedule), add the new page-level 'edit'
-- grant as an ADDITIONAL alternative path. Existing approval workflows and
-- project-scoping stay exactly as they were; a page-edit grant just gives
-- another way in, so an employee doesn't need can_approve or project
-- assignment just to create/update these records.
--
-- Also brings 'projects' and 'expenses' (currently is_super_admin()-only)
-- in line with the same model.
--
-- Using DROP + CREATE instead of ALTER POLICY: this repo's migrations/
-- folder does not necessarily match what has actually been applied to the
-- live database (confirmed: 0061_fix_claims_rls_update.sql was never run
-- there), so ALTER POLICY's "policy must already exist" requirement is
-- unsafe to rely on. DROP POLICY IF EXISTS + CREATE POLICY works whether or
-- not the policy currently exists.

-- ── vendors ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Vendors insertable by admins" ON public.vendors;
CREATE POLICY "Vendors insertable by admins" ON public.vendors
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
    OR public.has_page_access('vendors', 'edit')
  );

DROP POLICY IF EXISTS "Vendor access insertable by admins" ON public.vendor_project_access;
CREATE POLICY "Vendor access insertable by admins" ON public.vendor_project_access
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
    OR public.has_page_access('vendors', 'edit')
  );

DROP POLICY IF EXISTS "Invoices insert scoped" ON public.invoices;
CREATE POLICY "Invoices insert scoped" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.has_project_access(project_id)
    OR public.has_page_access('vendors', 'edit')
  );

DROP POLICY IF EXISTS "Invoice items insert scoped" ON public.invoice_items;
CREATE POLICY "Invoice items insert scoped" ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND (public.is_super_admin() OR public.has_project_access(i.project_id)))
    OR public.has_page_access('vendors', 'edit')
  );

DROP POLICY IF EXISTS "Vendor prior claims write super admin only" ON public.vendor_prior_claims;
CREATE POLICY "Vendor prior claims write super admin only" ON public.vendor_prior_claims
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('vendors', 'edit'))
  WITH CHECK (public.is_super_admin() OR public.has_page_access('vendors', 'edit'));

-- ── claims ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Claims insert scoped" ON public.claims;
CREATE POLICY "Claims insert scoped" ON public.claims
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.has_project_access(project_id)
    OR public.has_page_access('claims', 'edit')
  );

DROP POLICY IF EXISTS "Claims update scoped" ON public.claims;
CREATE POLICY "Claims update scoped" ON public.claims
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_project_access(project_id)
    OR public.has_page_access('claims', 'edit')
  );

DROP POLICY IF EXISTS "Claims delete scoped" ON public.claims;
CREATE POLICY "Claims delete scoped" ON public.claims
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_page_access('claims', 'edit')
  );

DROP POLICY IF EXISTS "Claim items insert scoped" ON public.claim_items;
CREATE POLICY "Claim items insert scoped" ON public.claim_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.claims c WHERE c.id = claim_id AND (public.is_super_admin() OR public.has_project_access(c.project_id)))
    OR public.has_page_access('claims', 'edit')
  );

DROP POLICY IF EXISTS "Claim items update scoped" ON public.claim_items;
CREATE POLICY "Claim items update scoped" ON public.claim_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.claims c WHERE c.id = claim_id AND (public.is_super_admin() OR public.has_project_access(c.project_id)))
    OR public.has_page_access('claims', 'edit')
  );

DROP POLICY IF EXISTS "Claim items delete scoped" ON public.claim_items;
CREATE POLICY "Claim items delete scoped" ON public.claim_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.claims c WHERE c.id = claim_id AND (public.is_super_admin() OR public.has_project_access(c.project_id)))
    OR public.has_page_access('claims', 'edit')
  );

DROP POLICY IF EXISTS "Retention insert scoped" ON public.retention_releases;
CREATE POLICY "Retention insert scoped" ON public.retention_releases
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
      AND (public.is_super_admin() OR public.has_project_access(project_id))
    )
    OR public.has_page_access('claims', 'edit')
  );

-- ── projects ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Projects editable by super admins" ON public.projects;
CREATE POLICY "Projects editable by super admins" ON public.projects
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('projects', 'edit'));

DROP POLICY IF EXISTS "Opening balance write super admin only" ON public.project_opening_balances;
CREATE POLICY "Opening balance write super admin only" ON public.project_opening_balances
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('projects', 'edit'))
  WITH CHECK (public.is_super_admin() OR public.has_page_access('projects', 'edit'));

DROP POLICY IF EXISTS "owner_payment_schedule insert scoped" ON public.owner_payment_schedule;
CREATE POLICY "owner_payment_schedule insert scoped" ON public.owner_payment_schedule
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
      AND (public.is_super_admin() OR public.has_project_access(project_id))
    )
    OR public.has_page_access('projects', 'edit')
  );

DROP POLICY IF EXISTS "owner_payment_schedule update scoped" ON public.owner_payment_schedule;
CREATE POLICY "owner_payment_schedule update scoped" ON public.owner_payment_schedule
  FOR UPDATE TO authenticated
  USING (
    (
      (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
      AND (public.is_super_admin() OR public.has_project_access(project_id))
    )
    OR public.has_page_access('projects', 'edit')
  );

DROP POLICY IF EXISTS "owner_payment_schedule delete scoped" ON public.owner_payment_schedule;
CREATE POLICY "owner_payment_schedule delete scoped" ON public.owner_payment_schedule
  FOR DELETE TO authenticated
  USING (
    (
      (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
      AND (public.is_super_admin() OR public.has_project_access(project_id))
    )
    OR public.has_page_access('projects', 'edit')
  );

-- ── expenses ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Expense categories editable by super admins" ON public.expense_categories;
CREATE POLICY "Expense categories editable by super admins" ON public.expense_categories
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('expenses', 'edit'));

DROP POLICY IF EXISTS "Category scopes manageable by super admins" ON public.expense_category_scopes;
CREATE POLICY "Category scopes manageable by super admins" ON public.expense_category_scopes
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('expenses', 'edit'))
  WITH CHECK (public.is_super_admin() OR public.has_page_access('expenses', 'edit'));

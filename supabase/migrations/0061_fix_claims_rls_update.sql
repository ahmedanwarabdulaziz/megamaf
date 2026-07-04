-- Fix: add UPDATE policy on claims table.
-- The claims table had ENABLE ROW LEVEL SECURITY with only SELECT + INSERT policies.
-- Without an UPDATE policy, all .update() calls are silently blocked by RLS.
-- This caused opening_paid_amount (and potentially claim_date / notes / tax) updates to fail.

CREATE POLICY "Claims update scoped" ON public.claims
  FOR UPDATE TO authenticated USING (
    public.is_super_admin() OR public.has_project_access(project_id)
  );

-- Also ensure DELETE is allowed for claims (for full CRUD support)
CREATE POLICY "Claims delete scoped" ON public.claims
  FOR DELETE TO authenticated USING (
    public.is_super_admin()
  );

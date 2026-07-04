-- Fix: add DELETE and UPDATE policies on claim_items so updateClaim can
-- replace items without RLS silently blocking the delete and causing duplicates.

-- Allow delete of claim_items scoped to project access
CREATE POLICY "Claim items delete scoped" ON public.claim_items
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.claims c
      WHERE c.id = claim_id
        AND (public.is_super_admin() OR public.has_project_access(c.project_id))
    )
  );

-- Allow update of claim_items scoped to project access
CREATE POLICY "Claim items update scoped" ON public.claim_items
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.claims c
      WHERE c.id = claim_id
        AND (public.is_super_admin() OR public.has_project_access(c.project_id))
    )
  );

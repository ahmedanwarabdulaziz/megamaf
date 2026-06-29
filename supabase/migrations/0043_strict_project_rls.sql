-- 0043_strict_project_rls.sql
-- Remove automatic access to is_main = true projects, requiring explicit access everywhere

DROP POLICY IF EXISTS "Projects viewable by super admin or if granted access" ON public.projects;

CREATE POLICY "Projects viewable by super admin or if granted access" ON public.projects
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR public.has_project_access(id)
  );

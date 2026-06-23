-- Add is_company_branch flag to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_company_branch boolean NOT NULL DEFAULT false;

-- Drop old admin-only delete policy and replace with one that blocks branch deletion
DROP POLICY IF EXISTS "Admins can delete projects in their company" ON public.projects;

CREATE POLICY "Admins can delete non-branch projects in their company"
  ON public.projects FOR DELETE
  USING (
    company_id = get_my_company_id()
    AND get_my_role() = 'admin'
    AND is_company_branch = false
  );

-- Seed the company branch for every existing company
INSERT INTO public.projects (company_id, name, status, is_company_branch)
SELECT c.id, 'الشركة', 'active', true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.company_id = c.id AND p.is_company_branch = true
);

-- Auto-create branch when a new company is created
CREATE OR REPLACE FUNCTION public.create_company_default_branch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.projects (company_id, name, status, is_company_branch)
  VALUES (NEW.id, 'الشركة', 'active', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_company_created_branch ON public.companies;
CREATE TRIGGER on_company_created_branch
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.create_company_default_branch();

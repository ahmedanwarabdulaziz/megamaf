-- ============================================================
-- Restore Projects Table
-- ============================================================

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'on_hold' | 'cancelled'
  start_date date,
  end_date date,
  budget numeric(14,2),
  is_company_branch boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT projects_company_code_key UNIQUE (company_id, code)
);

CREATE TRIGGER set_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read projects in their company"
  ON public.projects FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert projects in their company"
  ON public.projects FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update projects in their company"
  ON public.projects FOR UPDATE
  USING (company_id = get_my_company_id());

CREATE POLICY "Admins can delete non-branch projects in their company"
  ON public.projects FOR DELETE
  USING (
    company_id = get_my_company_id()
    AND get_my_role() = 'admin'
    AND is_company_branch = false
  );

-- Restore the function and trigger to automatically create the main company branch
CREATE OR REPLACE FUNCTION public.create_company_default_branch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.projects (company_id, name, code, status, is_company_branch)
  VALUES (NEW.id, 'الشركة', 'MAIN', 'active', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_company_created_branch ON public.companies;
CREATE TRIGGER on_company_created_branch
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.create_company_default_branch();

-- Seed the company branch for every existing company
INSERT INTO public.projects (company_id, name, code, status, is_company_branch)
SELECT c.id, 'الشركة', 'MAIN', 'active', true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.company_id = c.id AND p.is_company_branch = true
);

-- ============================================================
-- Restore employee_project_access
-- ============================================================
CREATE TABLE public.employee_project_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (employee_id, project_id)
);

ALTER TABLE public.employee_project_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read employee project access in their company"
  ON public.employee_project_access FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id AND e.company_id = get_my_company_id()
    )
  );

CREATE POLICY "Users can insert employee project access in their company"
  ON public.employee_project_access FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id AND e.company_id = get_my_company_id()
    )
  );

CREATE POLICY "Users can delete employee project access in their company"
  ON public.employee_project_access FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id AND e.company_id = get_my_company_id()
    )
  );

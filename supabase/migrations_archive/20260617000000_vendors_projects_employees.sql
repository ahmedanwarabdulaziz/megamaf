-- ============================================================
-- Vendors (Suppliers & Contractors), Projects, Employees
-- ============================================================

-- ============================================================
-- 1. VENDORS TABLE
-- ============================================================
CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'both', -- 'supplier' | 'contractor' | 'both'
  phone text,
  email text,
  address text,
  tax_number text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER set_vendors_updated_at
BEFORE UPDATE ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read vendors in their company"
  ON public.vendors FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert vendors in their company"
  ON public.vendors FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update vendors in their company"
  ON public.vendors FOR UPDATE
  USING (company_id = get_my_company_id());

CREATE POLICY "Admins can delete vendors in their company"
  ON public.vendors FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');


-- ============================================================
-- 2. PROJECTS TABLE
-- ============================================================
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'on_hold' | 'cancelled'
  start_date date,
  end_date date,
  budget numeric(14,2),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
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

CREATE POLICY "Admins can delete projects in their company"
  ON public.projects FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');


-- ============================================================
-- 3. EMPLOYEES TABLE
-- ============================================================
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  job_title text,
  phone text,
  email text,
  salary numeric(14,2),
  hire_date date,
  status text NOT NULL DEFAULT 'active', -- 'active' | 'inactive'
  is_super_admin boolean NOT NULL DEFAULT false, -- if true, bypasses project access restrictions
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER set_employees_updated_at
BEFORE UPDATE ON public.employees
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read employees in their company"
  ON public.employees FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert employees in their company"
  ON public.employees FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update employees in their company"
  ON public.employees FOR UPDATE
  USING (company_id = get_my_company_id());

CREATE POLICY "Admins can delete employees in their company"
  ON public.employees FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');


-- ============================================================
-- 4. EMPLOYEE_PROJECT_ACCESS — which projects each employee can access
--    If employee.is_super_admin = true, this table is ignored (all access).
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

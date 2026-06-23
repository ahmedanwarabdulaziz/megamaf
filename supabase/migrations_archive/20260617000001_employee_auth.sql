-- ============================================================
-- Employee Auth: username, auth_user_id, page access
-- ============================================================

-- 1. Add auth columns to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS username text UNIQUE,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Employee page access table
--    Controls which sections of the app the employee can see.
--    page_slug values: 'vendors' | 'projects' | 'employees' | 'accounts' | 'finance'
--    If employee.is_super_admin = true, this table is ignored (all pages shown).
CREATE TABLE public.employee_page_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  page_slug text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (employee_id, page_slug)
);

ALTER TABLE public.employee_page_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read employee page access in their company"
  ON public.employee_page_access FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id AND e.company_id = get_my_company_id()
    )
  );

CREATE POLICY "Users can manage employee page access in their company"
  ON public.employee_page_access FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id AND e.company_id = get_my_company_id()
    )
  );

CREATE POLICY "Users can delete employee page access in their company"
  ON public.employee_page_access FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id AND e.company_id = get_my_company_id()
    )
  );

-- 3. Employee users must be able to read their OWN employee record
--    (needed to check page access after login)
CREATE POLICY "Employees can read their own record"
  ON public.employees FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY "Employees can read their own page access"
  ON public.employee_page_access FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id AND e.auth_user_id = auth.uid()
    )
  );

-- 4. Update handle_new_user trigger to support 'employee' role
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_company_id uuid;
  user_count int;
  assigned_role text;
BEGIN
  -- Employee accounts are created by admin with is_employee metadata flag
  IF NEW.raw_user_meta_data->>'is_employee' = 'true' THEN
    assigned_role := 'employee';
    SELECT id INTO default_company_id FROM public.companies LIMIT 1;
    INSERT INTO public.profiles (id, company_id, role, full_name)
    VALUES (NEW.id, default_company_id, assigned_role, NEW.raw_user_meta_data->>'full_name');
    RETURN NEW;
  END IF;

  -- Normal user signup flow
  SELECT count(*) INTO user_count FROM public.profiles;
  
  IF user_count = 0 THEN
    assigned_role := 'admin';
    INSERT INTO public.companies (name) VALUES ('My Company') RETURNING id INTO default_company_id;
  ELSE
    assigned_role := 'member';
    SELECT id INTO default_company_id FROM public.companies LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, company_id, role, full_name)
  VALUES (NEW.id, default_company_id, assigned_role, NEW.raw_user_meta_data->>'full_name');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

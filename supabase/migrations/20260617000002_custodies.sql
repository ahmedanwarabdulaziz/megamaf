-- ============================================================
-- Custodies (العهد) for employees
-- Files are stored in Cloudflare R2, not Supabase Storage.
-- file_path stores the R2 object key: {company_id}/{uuid}.{ext}
-- ============================================================

-- 1. Add can_have_custody flag to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS can_have_custody boolean NOT NULL DEFAULT false;

-- 2. employee_custodies table
CREATE TABLE public.employee_custodies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  item text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  notes text,
  file_path text, -- R2 object key: {company_id}/{uuid}.{ext}
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER set_employee_custodies_updated_at
  BEFORE UPDATE ON public.employee_custodies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.employee_custodies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read custodies in their company"
  ON public.employee_custodies FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert custodies in their company"
  ON public.employee_custodies FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update custodies in their company"
  ON public.employee_custodies FOR UPDATE
  USING (company_id = get_my_company_id());

CREATE POLICY "Admins can delete custodies in their company"
  ON public.employee_custodies FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

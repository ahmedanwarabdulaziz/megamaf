-- ============================================================
-- Add owner_name to projects
-- ============================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_name text;

-- ============================================================
-- Project Funds Table
-- Records each fund injection by the project owner
-- ============================================================
CREATE TABLE public.project_funds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  note        text,
  fund_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TRIGGER set_project_funds_updated_at
BEFORE UPDATE ON public.project_funds
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.project_funds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read project_funds in their company"
  ON public.project_funds FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert project_funds in their company"
  ON public.project_funds FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update project_funds in their company"
  ON public.project_funds FOR UPDATE
  USING (company_id = get_my_company_id());

CREATE POLICY "Admins can delete project_funds in their company"
  ON public.project_funds FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

-- ─── 1. project_expenses table ───────────────────────────────────────────────
CREATE TABLE public.project_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  employee_id   uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  custody_id    uuid REFERENCES public.employee_custodies(id) ON DELETE SET NULL,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  description   text NOT NULL,
  amount        numeric(14,2) NOT NULL,
  expense_date  date NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.project_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read expenses in their company"
  ON public.project_expenses FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert expenses in their company"
  ON public.project_expenses FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Admins can delete expenses in their company"
  ON public.project_expenses FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

-- ─── 2. Add funding columns to employee_custodies ─────────────────────────────
ALTER TABLE public.employee_custodies
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funded_at        timestamptz;
-- funded_at IS NOT NULL  →  custody was funded and moved to expenses
-- bank_account_id        →  which account the money came from

-- Link a custody to the advance payment that settled it (null = not yet settled, or paid individually via payCustody)
ALTER TABLE public.employee_custodies
  ADD COLUMN IF NOT EXISTS settled_by_expense_id uuid REFERENCES public.project_expenses(id) ON DELETE SET NULL;

-- =======================================================================================
-- Partial Settlements Migration
-- Adds junction tables for partial payments of Vendor POs and Employee Custodies.
-- =======================================================================================

-- 1. Add caching columns
ALTER TABLE public.vendor_pos ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.employee_custodies ADD COLUMN IF NOT EXISTS funded_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS allocated_amount numeric(14,2) NOT NULL DEFAULT 0;

-- 2. Create vendor_po_settlements table
CREATE TABLE public.vendor_po_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vendor_po_id uuid NOT NULL REFERENCES public.vendor_pos(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.vendor_po_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access vendor_po_settlements in their company" 
  ON public.vendor_po_settlements USING (company_id = get_my_company_id());

-- 3. Create employee_custody_settlements table
CREATE TABLE public.employee_custody_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_custody_id uuid NOT NULL REFERENCES public.employee_custodies(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.employee_custody_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access employee_custody_settlements in their company" 
  ON public.employee_custody_settlements USING (company_id = get_my_company_id());

-- 4. Triggers to maintain vendor_pos.paid_amount and expenses.allocated_amount
CREATE OR REPLACE FUNCTION update_vendor_po_and_expense_allocations()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.vendor_pos SET paid_amount = paid_amount + NEW.amount WHERE id = NEW.vendor_po_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount + NEW.amount WHERE id = NEW.expense_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.vendor_pos SET paid_amount = paid_amount - OLD.amount WHERE id = OLD.vendor_po_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount - OLD.amount WHERE id = OLD.expense_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.vendor_pos SET paid_amount = paid_amount - OLD.amount + NEW.amount WHERE id = NEW.vendor_po_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount - OLD.amount + NEW.amount WHERE id = NEW.expense_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_vendor_po_settlements
AFTER INSERT OR UPDATE OR DELETE ON public.vendor_po_settlements
FOR EACH ROW EXECUTE FUNCTION update_vendor_po_and_expense_allocations();

-- 5. Triggers to maintain employee_custodies.funded_amount and expenses.allocated_amount
CREATE OR REPLACE FUNCTION update_custody_and_expense_allocations()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.employee_custodies SET funded_amount = funded_amount + NEW.amount WHERE id = NEW.employee_custody_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount + NEW.amount WHERE id = NEW.expense_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.employee_custodies SET funded_amount = funded_amount - OLD.amount WHERE id = OLD.employee_custody_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount - OLD.amount WHERE id = OLD.expense_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.employee_custodies SET funded_amount = funded_amount - OLD.amount + NEW.amount WHERE id = NEW.employee_custody_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount - OLD.amount + NEW.amount WHERE id = NEW.expense_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_employee_custody_settlements
AFTER INSERT OR UPDATE OR DELETE ON public.employee_custody_settlements
FOR EACH ROW EXECUTE FUNCTION update_custody_and_expense_allocations();

-- 6. Backfill existing data
INSERT INTO public.vendor_po_settlements (company_id, vendor_po_id, expense_id, amount)
SELECT company_id, id, settled_by_expense_id, amount
FROM public.vendor_pos
WHERE settled_by_expense_id IS NOT NULL;

INSERT INTO public.employee_custody_settlements (company_id, employee_custody_id, expense_id, amount)
SELECT company_id, id, settled_by_expense_id, amount
FROM public.employee_custodies
WHERE settled_by_expense_id IS NOT NULL;

-- 7. (Optional) Drop old columns. We leave them for now or drop them depending on preference.
-- We will drop them to enforce clean architecture and force fixing TypeScript errors.
ALTER TABLE public.vendor_pos 
  DROP COLUMN IF EXISTS settled_at,
  DROP COLUMN IF EXISTS settled_by_expense_id;

ALTER TABLE public.employee_custodies
  DROP COLUMN IF EXISTS funded_at,
  DROP COLUMN IF EXISTS settled_by_expense_id;

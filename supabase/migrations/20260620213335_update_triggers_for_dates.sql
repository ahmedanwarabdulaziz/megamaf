CREATE OR REPLACE FUNCTION update_vendor_po_and_expense_allocations()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.vendor_pos 
    SET paid_amount = paid_amount + NEW.amount,
        settled_at = CASE WHEN paid_amount + NEW.amount >= amount THEN now() ELSE NULL END
    WHERE id = NEW.vendor_po_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount + NEW.amount WHERE id = NEW.expense_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.vendor_pos 
    SET paid_amount = paid_amount - OLD.amount,
        settled_at = CASE WHEN paid_amount - OLD.amount >= amount THEN settled_at ELSE NULL END
    WHERE id = OLD.vendor_po_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount - OLD.amount WHERE id = OLD.expense_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.vendor_pos 
    SET paid_amount = paid_amount - OLD.amount + NEW.amount,
        settled_at = CASE WHEN paid_amount - OLD.amount + NEW.amount >= amount THEN COALESCE(settled_at, now()) ELSE NULL END
    WHERE id = NEW.vendor_po_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount - OLD.amount + NEW.amount WHERE id = NEW.expense_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_custody_and_expense_allocations()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.employee_custodies 
    SET funded_amount = funded_amount + NEW.amount,
        funded_at = CASE WHEN funded_amount + NEW.amount >= amount THEN now() ELSE NULL END
    WHERE id = NEW.employee_custody_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount + NEW.amount WHERE id = NEW.expense_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.employee_custodies 
    SET funded_amount = funded_amount - OLD.amount,
        funded_at = CASE WHEN funded_amount - OLD.amount >= amount THEN funded_at ELSE NULL END
    WHERE id = OLD.employee_custody_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount - OLD.amount WHERE id = OLD.expense_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.employee_custodies 
    SET funded_amount = funded_amount - OLD.amount + NEW.amount,
        funded_at = CASE WHEN funded_amount - OLD.amount + NEW.amount >= amount THEN COALESCE(funded_at, now()) ELSE NULL END
    WHERE id = NEW.employee_custody_id;
    UPDATE public.expenses SET allocated_amount = allocated_amount - OLD.amount + NEW.amount WHERE id = NEW.expense_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

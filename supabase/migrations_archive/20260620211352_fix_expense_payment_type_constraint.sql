-- Drop old constraints that might still be active under previous names
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS project_expenses_payment_type_check;
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_payment_type_check;

-- Create the unified constraint
ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_type_check 
  CHECK (payment_type IN ('custody', 'employee_advance', 'vendor_payment', 'vendor_advance', 'direct'));

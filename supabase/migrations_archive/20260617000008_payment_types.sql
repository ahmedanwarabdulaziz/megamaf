-- Add vendor_id + payment_type to project_expenses
-- payment_type: 'custody' (auto-created on custody pay) | 'employee_advance' | 'vendor_advance' | 'direct'

ALTER TABLE public.project_expenses
  ADD COLUMN IF NOT EXISTS vendor_id      uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_type   text NOT NULL DEFAULT 'custody'
    CHECK (payment_type IN ('custody', 'employee_advance', 'vendor_advance', 'direct')),
  ADD COLUMN IF NOT EXISTS notes          text;

-- Backfill existing rows (all were custody-based)
UPDATE public.project_expenses SET payment_type = 'custody' WHERE payment_type IS NULL OR payment_type = 'custody';

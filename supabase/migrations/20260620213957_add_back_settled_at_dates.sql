ALTER TABLE public.vendor_pos ADD COLUMN IF NOT EXISTS settled_at timestamptz;
ALTER TABLE public.employee_custodies ADD COLUMN IF NOT EXISTS funded_at timestamptz;

-- Set settled_at for any fully paid ones
UPDATE public.vendor_pos
SET settled_at = now()
WHERE paid_amount >= amount;

UPDATE public.employee_custodies
SET funded_at = now()
WHERE funded_amount >= amount;

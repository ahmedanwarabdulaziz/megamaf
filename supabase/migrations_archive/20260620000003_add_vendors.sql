-- ============================================================
-- Vendors, Vendor Project Access, Vendor POs, and Expense updates
-- ============================================================

-- ============================================================
-- 1. VENDORS TABLE
-- ============================================================
CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'both', -- 'supplier' | 'contractor' | 'both'
  phone text,
  email text,
  address text,
  tax_number text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER set_vendors_updated_at
BEFORE UPDATE ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read vendors in their company"
  ON public.vendors FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert vendors in their company"
  ON public.vendors FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update vendors in their company"
  ON public.vendors FOR UPDATE
  USING (company_id = get_my_company_id());

CREATE POLICY "Admins can delete vendors in their company"
  ON public.vendors FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

-- ============================================================
-- 2. VENDOR_PROJECT_ACCESS
-- ============================================================
CREATE TABLE public.vendor_project_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (vendor_id, project_id)
);

ALTER TABLE public.vendor_project_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read vendor project access in their company"
  ON public.vendor_project_access FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = vendor_id AND v.company_id = get_my_company_id()
    )
  );

CREATE POLICY "Users can insert vendor project access in their company"
  ON public.vendor_project_access FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = vendor_id AND v.company_id = get_my_company_id()
    )
  );

CREATE POLICY "Users can delete vendor project access in their company"
  ON public.vendor_project_access FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = vendor_id AND v.company_id = get_my_company_id()
    )
  );

-- ============================================================
-- 3. VENDOR_POS (Purchase Orders)
-- ============================================================
CREATE TABLE public.vendor_pos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  description text NOT NULL,
  po_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER set_vendor_pos_updated_at
BEFORE UPDATE ON public.vendor_pos
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.vendor_pos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read vendor_pos in their company"
  ON public.vendor_pos FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert vendor_pos in their company"
  ON public.vendor_pos FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update vendor_pos in their company"
  ON public.vendor_pos FOR UPDATE
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can delete vendor_pos in their company"
  ON public.vendor_pos FOR DELETE
  USING (company_id = get_my_company_id());


-- ============================================================
-- 4. UPDATE EXPENSES TABLE
-- ============================================================
-- The expenses table was previously `project_expenses` and had `vendor_id` and `project_id` dropped.
-- We re-add vendor_id and project_id for direct linking if necessary.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- Update payment_type constraint to include vendor_payment
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_payment_type_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_type_check 
  CHECK (payment_type IN ('custody', 'employee_advance', 'vendor_payment', 'direct'));

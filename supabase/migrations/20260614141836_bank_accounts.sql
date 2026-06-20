-- 1. Create `banks` table
CREATE TABLE public.banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Apply updated_at trigger to banks
CREATE TRIGGER set_banks_updated_at
BEFORE UPDATE ON public.banks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 2. Create `bank_accounts` table
CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  account_name text NOT NULL,
  account_number text,
  currency text NOT NULL DEFAULT 'EGP',
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Apply updated_at trigger to bank_accounts
CREATE TRIGGER set_bank_accounts_updated_at
BEFORE UPDATE ON public.bank_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 3. Row Level Security for `banks`
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read banks in their company"
  ON public.banks FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert banks in their company"
  ON public.banks FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Admins can update banks in their company"
  ON public.banks FOR UPDATE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

CREATE POLICY "Admins can delete banks in their company"
  ON public.banks FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

-- 4. Row Level Security for `bank_accounts`
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read bank accounts in their company"
  ON public.bank_accounts FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert bank accounts in their company"
  ON public.bank_accounts FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Admins can update bank accounts in their company"
  ON public.bank_accounts FOR UPDATE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

CREATE POLICY "Admins can delete bank accounts in their company"
  ON public.bank_accounts FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

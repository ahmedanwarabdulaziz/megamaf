-- ============================================================
-- FILE: 0001_phase1_foundation.sql
-- ============================================================
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================================
-- 1. Org & Users
-- ============================================================================

CREATE TABLE public.project_owners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  node_type text not null check (node_type in ('main_company', 'project', 'branch', 'phase')),
  parent_id uuid references public.projects(id),
  owner_id uuid references public.project_owners(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  is_main boolean not null default false,
  sort_order integer default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed Main Company (cannot be closed/deleted).
INSERT INTO public.projects (id, name, code, node_type, is_main, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'MAF Main Company', 'MAIN', 'main_company', true, 'open');

CREATE TABLE public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  username citext unique not null,
  pin_hash text,
  role text not null check (role in ('owner', 'standard')),
  is_active boolean not null default true,
  is_super_admin boolean not null default false,
  can_approve boolean not null default false,
  phone text,
  auth_user_id uuid references auth.users(id),
  failed_pin_attempts integer not null default 0,
  locked_until timestamptz,
  active_session_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.employee_page_access (
  employee_id uuid references public.employees(id) on delete cascade,
  page_slug text not null,
  created_at timestamptz default now(),
  primary key (employee_id, page_slug)
);

CREATE TABLE public.employee_project_access (
  employee_id uuid references public.employees(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (employee_id, project_id)
);

CREATE TABLE public.user_credentials (
  employee_id uuid references public.employees(id) on delete cascade,
  credential_id text unique not null,
  public_key text not null,
  counter bigint not null default 0,
  transports text[],
  device_label text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (employee_id, credential_id)
);

CREATE TABLE public.user_sessions (
  employee_id uuid references public.employees(id) on delete cascade,
  token_hash text not null,
  device text,
  ip text,
  last_seen timestamptz default now(),
  created_at timestamptz default now(),
  primary key (employee_id, token_hash)
);

-- ============================================================================
-- 2. Audit & Attachments
-- ============================================================================

CREATE TABLE public.audit_log (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id),
  action text not null check (action in ('create','update','delete','approve','login','logout')),
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz default now()
);

CREATE TABLE public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  r2_key text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.employees(id),
  created_at timestamptz default now()
);

-- ============================================================================
-- 9. Settings
-- ============================================================================

CREATE TABLE public.app_settings (
  key text primary key,
  value jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed Settings
INSERT INTO public.app_settings (key, value)
VALUES 
  ('currencies', '["EGP"]'::jsonb),
  ('lockout_policy', '{"max_attempts": 5, "lockout_minutes": 15}'::jsonb);

-- Indexes
CREATE INDEX idx_audit_entity ON public.audit_log (entity_type, entity_id);
CREATE INDEX idx_attach_entity ON public.attachments (entity_type, entity_id);

-- ============================================================================
-- RLS Functions
-- ============================================================================

-- A fast, secure way to get the current employee ID based on the Supabase auth.uid()
CREATE OR REPLACE FUNCTION public.current_employee_id() RETURNS uuid AS $$
  SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if the current user is a super admin
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean AS $$
  SELECT is_super_admin FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if the current user has access to a specific project
CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_project_access 
    WHERE employee_id = public.current_employee_id() 
    AND project_id = p_project_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================================
-- Enable RLS and create policies
-- ============================================================================

ALTER TABLE public.project_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_page_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_project_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 1. App Settings: Everyone can read, only super admins can edit.
CREATE POLICY "App settings are viewable by all authenticated users" ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "App settings can be changed by super admins" ON public.app_settings
  FOR ALL TO authenticated USING (public.is_super_admin());

-- 2. Projects & Owners: Viewable if you have project access or if you are super admin. Edit for super admins.
CREATE POLICY "Owners viewable if super admin or related project access" ON public.project_owners
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR 
    EXISTS (SELECT 1 FROM public.projects WHERE projects.owner_id = project_owners.id AND public.has_project_access(projects.id))
  );
CREATE POLICY "Owners editable by super admins" ON public.project_owners
  FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Projects viewable by super admin or if granted access" ON public.projects
  FOR SELECT TO authenticated USING (
    public.is_super_admin() OR public.has_project_access(id) OR is_main = true
  );
CREATE POLICY "Projects editable by super admins" ON public.projects
  FOR ALL TO authenticated USING (public.is_super_admin());

-- 3. Employees: Everyone authenticated can see the list (to pick names etc), but only super admins can edit.
CREATE POLICY "Employees viewable by all authenticated users" ON public.employees
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Employees editable by super admins" ON public.employees
  FOR ALL TO authenticated USING (public.is_super_admin());

-- Employee Access: Viewable by the employee themselves or super admins. Editable by super admins.
CREATE POLICY "Page access viewable by self or super admin" ON public.employee_page_access
  FOR SELECT TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());
CREATE POLICY "Page access editable by super admin" ON public.employee_page_access
  FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Project access viewable by self or super admin" ON public.employee_project_access
  FOR SELECT TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());
CREATE POLICY "Project access editable by super admin" ON public.employee_project_access
  FOR ALL TO authenticated USING (public.is_super_admin());

-- Credentials & Sessions: Only viewable/editable by the employee themselves or super admin.
CREATE POLICY "Credentials viewable by self or super admin" ON public.user_credentials
  FOR SELECT TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());
CREATE POLICY "Credentials editable by self or super admin" ON public.user_credentials
  FOR ALL TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());

CREATE POLICY "Sessions viewable by self or super admin" ON public.user_sessions
  FOR SELECT TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());
CREATE POLICY "Sessions editable by self or super admin" ON public.user_sessions
  FOR ALL TO authenticated USING (employee_id = public.current_employee_id() OR public.is_super_admin());

-- 4. Audit Log: Viewable by super admins. Insertable by all authenticated users (handled via secure server function mostly).
CREATE POLICY "Audit log viewable by super admins" ON public.audit_log
  FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "Audit log insertable by all" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- 5. Attachments: Viewable by all authenticated (they may be related to any document), insertable by all.
CREATE POLICY "Attachments viewable by all authenticated users" ON public.attachments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Attachments insertable by all authenticated users" ON public.attachments
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Attachments updatable/deletable by super admin" ON public.attachments
  FOR UPDATE TO authenticated USING (public.is_super_admin());
CREATE POLICY "Attachments deletable by super admin" ON public.attachments
  FOR DELETE TO authenticated USING (public.is_super_admin());

-- ============================================================
-- FILE: 0002_phase2_projects.sql
-- ============================================================
-- Phase 2 Projects Database Setup

-- Create a financial position view stub. 
-- In later phases (Ledger & Claims), this view will aggregate real financial data.
-- For now, it provides a stable API for the UI to consume.

CREATE OR REPLACE VIEW public.v_project_financial_position AS
SELECT 
    id as project_id,
    0.0 as total_income,
    0.0 as total_expenses,
    0.0 as balance
FROM public.projects;

-- Note: The base tables `projects` and `project_owners` 
-- along with their RLS policies were already created in 0001_phase1_foundation.sql

-- ============================================================
-- FILE: 0003_phase1_hardening.sql
-- ============================================================
-- ============================================================================
-- 1. Security: Create employee_secrets to protect PINs
-- ============================================================================

CREATE TABLE public.employee_secrets (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  pin_hash text,
  failed_pin_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- Migrate existing data
INSERT INTO public.employee_secrets (employee_id, pin_hash, failed_pin_attempts, locked_until)
SELECT id, pin_hash, failed_pin_attempts, locked_until
FROM public.employees;

-- Drop insecure columns from employees
ALTER TABLE public.employees 
  DROP COLUMN pin_hash, 
  DROP COLUMN failed_pin_attempts, 
  DROP COLUMN locked_until;

-- Enable RLS with NO policies for authenticated users (Service Role only)
ALTER TABLE public.employee_secrets ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Security: Views must respect RLS (security_invoker)
-- ============================================================================

ALTER VIEW public.v_project_financial_position SET (security_invoker = true);

-- ============================================================================
-- 3. Performance: Add missing indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_employees_auth_user_id ON public.employees(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_parent_id ON public.projects(parent_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON public.projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_epa_project_id ON public.employee_project_access(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_employee_id ON public.audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by ON public.attachments(uploaded_by);

-- ============================================================================
-- 4. Correctness: Protect Main Company from closure or deletion
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_main_company()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_main = true THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'ظ„ط§ ظٹظ…ظƒظ† ط­ط°ظپ ط§ظ„ط´ط±ظƒط© ط§ظ„ط±ط¦ظٹط³ظٹط©';
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'closed' THEN
      RAISE EXCEPTION 'ظ„ط§ ظٹظ…ظƒظ† ط¥ط؛ظ„ط§ظ‚ ط§ظ„ط´ط±ظƒط© ط§ظ„ط±ط¦ظٹط³ظٹط©';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_main_company
  BEFORE UPDATE OR DELETE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_main_company();

-- ============================================================================
-- 5. Correctness: Auto updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_updated_at_employees BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_projects BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_project_owners BEFORE UPDATE ON public.project_owners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_app_settings BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_user_credentials BEFORE UPDATE ON public.user_credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_employee_secrets BEFORE UPDATE ON public.employee_secrets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 6. Access Scope: Cascade project access to subtree (Recursive)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id uuid) RETURNS boolean AS $$
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id FROM public.projects WHERE id = p_project_id
    UNION ALL
    SELECT p.id, p.parent_id FROM public.projects p
    JOIN ancestors a ON p.id = a.parent_id
  )
  SELECT EXISTS (
    SELECT 1 FROM public.employee_project_access epa
    WHERE epa.employee_id = public.current_employee_id()
      AND epa.project_id IN (SELECT id FROM ancestors)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================================
-- 7. Audit Log: Harden insertion
-- ============================================================================

DROP POLICY IF EXISTS "Audit log insertable by all" ON public.audit_log;

CREATE POLICY "Audit log insertable by all" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (employee_id = public.current_employee_id());

-- ============================================================
-- FILE: 0004_phase3_ledger_banks.sql
-- ============================================================
-- 0004_phase3_ledger_banks.sql

-- 1. Create banks table
CREATE TABLE banks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create bank_accounts table
CREATE TABLE bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
    account_name TEXT NOT NULL,
    account_number TEXT NOT NULL UNIQUE,
    opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EGP',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create ledger_entries table
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_date DATE NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL CHECK (
        category IN (
            'opening_balance',
            'bank_in',
            'bank_out',
            'custody_disbursement',
            'vendor_payment',
            'owner_payment',
            'deposit_collection',
            'interest',
            'deduction',
            'transfer_in',
            'transfer_out'
        )
    ),
    bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE RESTRICT,
    project_id UUID REFERENCES projects(id) ON DELETE RESTRICT,
    employee_id UUID REFERENCES employees(id) ON DELETE RESTRICT,
    counterparty_type TEXT CHECK (
        counterparty_type IN ('vendor', 'owner', 'employee', 'bank', 'internal')
    ),
    counterparty_id UUID,
    source_type TEXT,
    source_id UUID,
    memo TEXT,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create Indexes
CREATE INDEX idx_ledger_bank_account_date ON ledger_entries(bank_account_id, entry_date);
CREATE INDEX idx_ledger_project_date ON ledger_entries(project_id, entry_date);
CREATE INDEX idx_ledger_employee_id ON ledger_entries(employee_id);
CREATE INDEX idx_ledger_counterparty ON ledger_entries(counterparty_type, counterparty_id);

-- 5. Views
-- v_bank_account_balances
-- We assume the 'opening_balance' ledger row is included in ledger_entries.
-- The current balance is simply the sum of all in/out ledger entries for that account.
CREATE OR REPLACE VIEW v_bank_account_balances WITH (security_invoker = true) AS
SELECT 
    ba.id AS bank_account_id,
    ba.bank_id,
    b.name AS bank_name,
    ba.account_name,
    ba.account_number,
    ba.currency,
    ba.opening_balance AS initial_balance,
    COALESCE(SUM(
        CASE 
            WHEN le.direction = 'in' THEN le.amount 
            WHEN le.direction = 'out' THEN -le.amount 
            ELSE 0 
        END
    ), 0) AS current_balance
FROM bank_accounts ba
JOIN banks b ON ba.bank_id = b.id
LEFT JOIN ledger_entries le ON ba.id = le.bank_account_id
GROUP BY ba.id, ba.bank_id, b.name, ba.account_name, ba.account_number, ba.currency, ba.opening_balance;

-- v_bank_statement
-- Ordered running balance.
-- We use a window function over ledger_entries ordered by entry_date and created_at.
CREATE OR REPLACE VIEW v_bank_statement WITH (security_invoker = true) AS
SELECT 
    le.id,
    le.bank_account_id,
    le.entry_date,
    le.created_at,
    le.direction,
    le.amount,
    le.category,
    le.memo,
    le.counterparty_type,
    le.counterparty_id,
    SUM(
        CASE 
            WHEN le.direction = 'in' THEN le.amount 
            WHEN le.direction = 'out' THEN -le.amount 
            ELSE 0 
        END
    ) OVER (
        PARTITION BY le.bank_account_id 
        ORDER BY le.entry_date ASC, le.created_at ASC
    ) AS running_balance
FROM ledger_entries le
WHERE le.bank_account_id IS NOT NULL;

-- 6. Row Level Security (RLS)
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

-- Policy: Employees can view banks
CREATE POLICY "Banks viewable by all authenticated users" ON public.banks
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Banks editable by super admins" ON public.banks
    FOR ALL TO authenticated USING (public.is_super_admin());

-- Policy: Employees can view bank accounts
CREATE POLICY "Bank accounts viewable by all authenticated users" ON public.bank_accounts
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Bank accounts editable by super admins" ON public.bank_accounts
    FOR ALL TO authenticated USING (public.is_super_admin());

-- Policy: Employees can view ledger entries
CREATE POLICY "Ledger entries viewable by all authenticated users" ON public.ledger_entries
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Ledger entries insertable by all authenticated users" ON public.ledger_entries
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Ledger entries editable by super admins" ON public.ledger_entries
    FOR UPDATE TO authenticated USING (public.is_super_admin());
CREATE POLICY "Ledger entries deletable by super admins" ON public.ledger_entries
    FOR DELETE TO authenticated USING (public.is_super_admin());

-- ============================================================
-- FILE: 0005_phase3_hardening.sql
-- ============================================================
-- 0005_phase3_hardening.sql

-- 1. Create has_page_access function
CREATE OR REPLACE FUNCTION public.has_page_access(p_slug text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_page_access 
    WHERE employee_id = public.current_employee_id() 
    AND page_slug = p_slug
  ) OR public.is_super_admin();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2. Drop existing policies on ledger_entries, banks, bank_accounts
DROP POLICY IF EXISTS "Ledger entries viewable by all authenticated users" ON public.ledger_entries;
DROP POLICY IF EXISTS "Ledger entries insertable by all authenticated users" ON public.ledger_entries;
DROP POLICY IF EXISTS "Ledger entries editable by super admins" ON public.ledger_entries;
DROP POLICY IF EXISTS "Ledger entries deletable by super admins" ON public.ledger_entries;

DROP POLICY IF EXISTS "Banks viewable by all authenticated users" ON public.banks;
DROP POLICY IF EXISTS "Banks editable by super admins" ON public.banks;

DROP POLICY IF EXISTS "Bank accounts viewable by all authenticated users" ON public.bank_accounts;
DROP POLICY IF EXISTS "Bank accounts editable by super admins" ON public.bank_accounts;

-- 3. Scope SELECT Policies
-- ledger_entries
CREATE POLICY "Ledger scoped select" ON public.ledger_entries
    FOR SELECT TO authenticated
    USING (
        public.is_super_admin()
        OR (bank_account_id IS NOT NULL AND public.has_page_access('banks'))
        OR (project_id IS NOT NULL AND public.has_project_access(project_id))
    );

-- banks & bank_accounts
CREATE POLICY "Banks select scope" ON public.banks
    FOR SELECT TO authenticated
    USING (public.has_page_access('banks'));
CREATE POLICY "Banks update scope" ON public.banks
    FOR ALL TO authenticated
    USING (public.is_super_admin());

CREATE POLICY "Bank accounts select scope" ON public.bank_accounts
    FOR SELECT TO authenticated
    USING (public.has_page_access('banks'));
CREATE POLICY "Bank accounts update scope" ON public.bank_accounts
    FOR ALL TO authenticated
    USING (public.is_super_admin());

-- 4. Make ledger immutable
ALTER TABLE public.ledger_entries DROP COLUMN IF EXISTS updated_at;
-- Only super admins can manually insert. Others must use RPCs.
CREATE POLICY "Ledger entries insertable by super admin" ON public.ledger_entries
    FOR INSERT TO authenticated
    WITH CHECK (public.is_super_admin());
-- NO UPDATE OR DELETE POLICIES

-- 5. Add set_updated_at triggers
CREATE TRIGGER trg_set_updated_at_banks BEFORE UPDATE ON public.banks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_bank_accounts BEFORE UPDATE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. RPCs for atomic operations

-- create_bank_account
CREATE OR REPLACE FUNCTION public.create_bank_account(
    p_bank_id uuid,
    p_account_name text,
    p_account_number text,
    p_opening_balance numeric,
    p_currency text DEFAULT 'EGP'
) RETURNS uuid AS $$
DECLARE
    v_account_id uuid;
    v_employee_id uuid;
BEGIN
    -- Check permissions
    IF NOT public.has_page_access('banks') THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_employee_id := public.current_employee_id();

    -- Check duplicate account_number
    IF EXISTS (SELECT 1 FROM public.bank_accounts WHERE account_number = p_account_number) THEN
        RAISE EXCEPTION 'ط±ظ‚ظ… ط§ظ„ط­ط³ط§ط¨ ظ…ط³ط¬ظ„ ط¨ط§ظ„ظپط¹ظ„';
    END IF;

    -- Insert account
    INSERT INTO public.bank_accounts (bank_id, account_name, account_number, opening_balance, currency)
    VALUES (p_bank_id, p_account_name, p_account_number, p_opening_balance, p_currency)
    RETURNING id INTO v_account_id;

    -- Insert opening balance if != 0
    IF p_opening_balance != 0 THEN
        INSERT INTO public.ledger_entries (
            entry_date, direction, amount, category, bank_account_id, memo, created_by, counterparty_type
        ) VALUES (
            CURRENT_DATE,
            CASE WHEN p_opening_balance > 0 THEN 'in' ELSE 'out' END,
            ABS(p_opening_balance),
            'opening_balance',
            v_account_id,
            'Opening Balance',
            v_employee_id,
            'bank'
        );
    END IF;

    -- Audit Log
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_employee_id, 
        'create', 
        'bank_account', 
        v_account_id, 
        jsonb_build_object('bank_id', p_bank_id, 'account_name', p_account_name, 'account_number', p_account_number, 'opening_balance', p_opening_balance)
    );

    RETURN v_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- create_transfer
CREATE OR REPLACE FUNCTION public.create_transfer(
    p_from_account_id uuid,
    p_to_account_id uuid,
    p_amount numeric,
    p_date date,
    p_memo text
) RETURNS void AS $$
DECLARE
    v_employee_id uuid;
    v_out_id uuid;
BEGIN
    -- Check permissions
    IF NOT public.has_page_access('banks') THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    IF p_from_account_id = p_to_account_id THEN
        RAISE EXCEPTION 'Cannot transfer to the same account';
    END IF;

    v_employee_id := public.current_employee_id();

    -- transfer_out
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, memo, created_by, counterparty_type, counterparty_id
    ) VALUES (
        p_date, 'out', p_amount, 'transfer_out', p_from_account_id, p_memo, v_employee_id, 'bank', p_to_account_id
    ) RETURNING id INTO v_out_id;

    -- transfer_in
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, memo, created_by, counterparty_type, counterparty_id
    ) VALUES (
        p_date, 'in', p_amount, 'transfer_in', p_to_account_id, p_memo, v_employee_id, 'bank', p_from_account_id
    );

    -- Audit Log
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_employee_id, 
        'create', 
        'transfer', 
        v_out_id, 
        jsonb_build_object('from_account_id', p_from_account_id, 'to_account_id', p_to_account_id, 'amount', p_amount, 'date', p_date, 'memo', p_memo)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- add_ledger_adjustment
CREATE OR REPLACE FUNCTION public.add_ledger_adjustment(
    p_bank_account_id uuid,
    p_amount numeric,
    p_type text, -- 'interest' or 'deduction'
    p_date date,
    p_memo text
) RETURNS uuid AS $$
DECLARE
    v_employee_id uuid;
    v_ledger_id uuid;
    v_direction text;
BEGIN
    IF NOT public.has_page_access('banks') THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;

    IF p_type NOT IN ('interest', 'deduction') THEN
        RAISE EXCEPTION 'Invalid adjustment type';
    END IF;

    v_direction := CASE WHEN p_type = 'interest' THEN 'in' ELSE 'out' END;
    v_employee_id := public.current_employee_id();

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, memo, created_by, counterparty_type
    ) VALUES (
        p_date, v_direction, p_amount, p_type, p_bank_account_id, p_memo, v_employee_id, 'bank'
    ) RETURNING id INTO v_ledger_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_employee_id, 
        'create', 
        'ledger_entry', 
        v_ledger_id, 
        jsonb_build_object('bank_account_id', p_bank_account_id, 'type', p_type, 'amount', p_amount, 'date', p_date, 'memo', p_memo)
    );

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- reverse_ledger_entry
CREATE OR REPLACE FUNCTION public.reverse_ledger_entry(
    p_entry_id uuid,
    p_reason text
) RETURNS uuid AS $$
DECLARE
    v_employee_id uuid;
    v_old_entry record;
    v_new_id uuid;
    v_new_direction text;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super admins can reverse ledger entries';
    END IF;

    v_employee_id := public.current_employee_id();

    SELECT * INTO v_old_entry FROM public.ledger_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Entry not found';
    END IF;

    v_new_direction := CASE WHEN v_old_entry.direction = 'in' THEN 'out' ELSE 'in' END;

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, project_id, employee_id, 
        counterparty_type, counterparty_id, source_type, source_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, v_new_direction, v_old_entry.amount, v_old_entry.category, 
        v_old_entry.bank_account_id, v_old_entry.project_id, v_old_entry.employee_id,
        v_old_entry.counterparty_type, v_old_entry.counterparty_id, 
        'reversal', p_entry_id, p_reason, v_employee_id
    ) RETURNING id INTO v_new_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before, after)
    VALUES (
        v_employee_id, 
        'create', 
        'ledger_reversal', 
        v_new_id, 
        jsonb_build_object('reversed_entry_id', p_entry_id),
        jsonb_build_object('reason', p_reason, 'new_entry_id', v_new_id)
    );

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FILE: 0006_phase4_custody_expenses.sql
-- ============================================================
-- 0006_phase4_custody_expenses.sql

-- 1. Extend Employees
ALTER TABLE public.employees ADD COLUMN has_custody_access boolean DEFAULT false;

-- 2. Expense Categories
CREATE TABLE public.expense_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    parent_id uuid REFERENCES public.expense_categories(id) ON DELETE CASCADE,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. Expenses
CREATE TABLE public.expenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT,
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    category_id uuid NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
    expense_date date NOT NULL,
    amount numeric(18,2) NOT NULL CHECK (amount > 0),
    notes text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by uuid REFERENCES public.employees(id) ON DELETE RESTRICT,
    approved_at timestamptz,
    settled_amount numeric(18,2) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 4. Custody Settlements
CREATE TABLE public.custody_settlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
    disbursement_ledger_id uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
    amount numeric(18,2) NOT NULL CHECK (amount > 0),
    created_at timestamptz DEFAULT now()
);

-- 5. Views
CREATE OR REPLACE VIEW public.v_employee_custody_balance WITH (security_invoker = true) AS
SELECT 
    e.id AS employee_id,
    e.full_name,
    COALESCE(disb.total_disbursed, 0) AS total_disbursed,
    COALESCE(exp.total_approved, 0) AS total_approved_expenses,
    COALESCE(setl.total_settled, 0) AS total_settled,
    COALESCE(disb.total_disbursed, 0) - COALESCE(exp.total_approved, 0) AS balance
FROM public.employees e
LEFT JOIN (
    SELECT employee_id, SUM(amount) AS total_disbursed
    FROM public.ledger_entries
    WHERE category = 'custody_disbursement' AND direction = 'in'
    GROUP BY employee_id
) disb ON e.id = disb.employee_id
LEFT JOIN (
    SELECT employee_id, SUM(amount) AS total_approved
    FROM public.expenses
    WHERE status = 'approved'
    GROUP BY employee_id
) exp ON e.id = exp.employee_id
LEFT JOIN (
    SELECT employee_id, SUM(amount) AS total_settled
    FROM public.custody_settlements
    GROUP BY employee_id
) setl ON e.id = setl.employee_id
WHERE e.has_custody_access = true 
   OR disb.total_disbursed IS NOT NULL 
   OR exp.total_approved IS NOT NULL;

-- 6. RPCs

-- settle_employee_custody
CREATE OR REPLACE FUNCTION public.settle_employee_custody(p_employee_id uuid) RETURNS void AS $$
DECLARE
    v_expense record;
    v_disb record;
    v_expense_remaining numeric;
    v_disb_remaining numeric;
    v_settle_amount numeric;
BEGIN
    FOR v_expense IN 
        SELECT id, amount, settled_amount 
        FROM public.expenses 
        WHERE employee_id = p_employee_id 
          AND status = 'approved' 
          AND amount > settled_amount 
        ORDER BY expense_date ASC, id ASC
    LOOP
        v_expense_remaining := v_expense.amount - v_expense.settled_amount;

        FOR v_disb IN 
            SELECT le.id, le.amount, 
                   COALESCE(SUM(cs.amount), 0) AS allocated_amount
            FROM public.ledger_entries le
            LEFT JOIN public.custody_settlements cs ON le.id = cs.disbursement_ledger_id
            WHERE le.employee_id = p_employee_id 
              AND le.category = 'custody_disbursement' 
              AND le.direction = 'in'
            GROUP BY le.id, le.amount, le.entry_date
            HAVING le.amount > COALESCE(SUM(cs.amount), 0)
            ORDER BY le.entry_date ASC, le.id ASC
        LOOP
            v_disb_remaining := v_disb.amount - v_disb.allocated_amount;
            
            IF v_disb_remaining > 0 AND v_expense_remaining > 0 THEN
                v_settle_amount := LEAST(v_disb_remaining, v_expense_remaining);
                
                INSERT INTO public.custody_settlements (employee_id, expense_id, disbursement_ledger_id, amount)
                VALUES (p_employee_id, v_expense.id, v_disb.id, v_settle_amount);
                
                v_expense_remaining := v_expense_remaining - v_settle_amount;
                
                UPDATE public.expenses 
                SET settled_amount = settled_amount + v_settle_amount 
                WHERE id = v_expense.id;
            END IF;

            IF v_expense_remaining <= 0 THEN
                EXIT;
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- approve_expense
CREATE OR REPLACE FUNCTION public.approve_expense(p_expense_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id uuid;
    v_target_employee uuid;
    v_status text;
    v_can_approve boolean;
BEGIN
    v_employee_id := public.current_employee_id();

    SELECT can_approve INTO v_can_approve FROM public.employees WHERE id = v_employee_id;
    
    IF NOT v_can_approve AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to approve expenses';
    END IF;

    SELECT employee_id, status INTO v_target_employee, v_status FROM public.expenses WHERE id = p_expense_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
    IF v_status != 'pending' THEN RAISE EXCEPTION 'Expense already processed'; END IF;

    UPDATE public.expenses 
    SET status = 'approved', approved_by = v_employee_id, approved_at = now() 
    WHERE id = p_expense_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_employee_id, 'approve', 'expense', p_expense_id, jsonb_build_object('status', 'approved'));

    PERFORM public.settle_employee_custody(v_target_employee);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- disburse_custody
CREATE OR REPLACE FUNCTION public.disburse_custody(
    p_bank_account_id uuid,
    p_employee_id uuid,
    p_amount numeric,
    p_date date,
    p_memo text
) RETURNS uuid AS $$
DECLARE
    v_creator_id uuid;
    v_out_id uuid;
    v_in_id uuid;
BEGIN
    IF NOT public.has_page_access('treasury/custody') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    v_creator_id := public.current_employee_id();

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, memo, created_by, counterparty_type, counterparty_id
    ) VALUES (
        p_date, 'out', p_amount, 'custody_disbursement', p_bank_account_id, p_memo, v_creator_id, 'employee', p_employee_id
    ) RETURNING id INTO v_out_id;

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, employee_id, memo, created_by, counterparty_type, counterparty_id
    ) VALUES (
        p_date, 'in', p_amount, 'custody_disbursement', p_employee_id, p_memo, v_creator_id, 'bank', p_bank_account_id
    ) RETURNING id INTO v_in_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_creator_id, 'create', 'custody_disbursement', v_out_id, 
        jsonb_build_object('bank_account_id', p_bank_account_id, 'employee_id', p_employee_id, 'amount', p_amount)
    );

    PERFORM public.settle_employee_custody(p_employee_id);

    RETURN v_in_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- reject_expense
CREATE OR REPLACE FUNCTION public.reject_expense(p_expense_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id uuid;
    v_status text;
    v_can_approve boolean;
BEGIN
    v_employee_id := public.current_employee_id();

    SELECT can_approve INTO v_can_approve FROM public.employees WHERE id = v_employee_id;
    IF NOT v_can_approve AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to reject expenses';
    END IF;

    SELECT status INTO v_status FROM public.expenses WHERE id = p_expense_id;
    IF v_status != 'pending' THEN RAISE EXCEPTION 'Expense already processed'; END IF;

    UPDATE public.expenses 
    SET status = 'rejected', approved_by = v_employee_id, approved_at = now() 
    WHERE id = p_expense_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_employee_id, 'reject', 'expense', p_expense_id, jsonb_build_object('status', 'rejected'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Triggers
CREATE TRIGGER trg_set_updated_at_exp_cats BEFORE UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_expenses BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. Indexes
CREATE INDEX idx_expenses_employee_id ON public.expenses(employee_id);
CREATE INDEX idx_expenses_status ON public.expenses(status);
CREATE INDEX idx_expenses_date ON public.expenses(expense_date);
CREATE INDEX idx_custody_settlements_employee_id ON public.custody_settlements(employee_id);

-- 9. RLS Policies
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expense categories viewable by all authenticated users" ON public.expense_categories
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Expense categories editable by super admins" ON public.expense_categories
    FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Expenses viewable by creator or approvers" ON public.expenses
    FOR SELECT TO authenticated USING (
        employee_id = public.current_employee_id() 
        OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
        OR public.is_super_admin()
    );

CREATE POLICY "Expenses insertable by self if custody access" ON public.expenses
    FOR INSERT TO authenticated WITH CHECK (
        employee_id = public.current_employee_id() AND
        (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
    );

CREATE POLICY "Custody settlements viewable by employee or treasury" ON public.custody_settlements
    FOR SELECT TO authenticated USING (
        employee_id = public.current_employee_id()
        OR public.has_page_access('treasury/custody')
        OR public.is_super_admin()
    );

-- ============================================================
-- FILE: 0007_phase4_hardening.sql
-- ============================================================
-- 0007_phase4_hardening.sql

-- FIX 1: Enforce project access on expense create
DROP POLICY IF EXISTS "Expenses insertable by self if custody access" ON public.expenses;
CREATE POLICY "Expenses insert scoped" ON public.expenses
  FOR INSERT TO authenticated WITH CHECK (
    employee_id = public.current_employee_id()
    AND (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
    AND public.has_project_access(project_id)
  );

-- FIX 2: Scope approver expense visibility to granted projects
DROP POLICY IF EXISTS "Expenses viewable by creator or approvers" ON public.expenses;
CREATE POLICY "Expenses select scoped" ON public.expenses
  FOR SELECT TO authenticated USING (
    employee_id = public.current_employee_id()
    OR public.is_super_admin()
    OR (
      (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
      AND public.has_project_access(project_id)
    )
  );

-- ============================================================
-- FILE: 0008_phase5_vendors_claims.sql
-- ============================================================
-- 0008_phase5_vendors_claims.sql

-- 1. VENDORS
CREATE TABLE public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('vendor', 'contractor')),
  phone text,
  notes text,
  all_projects boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.vendor_project_access (
  vendor_id uuid references public.vendors(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (vendor_id, project_id)
);

-- 2. INVOICES
CREATE TABLE public.invoices (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  project_id uuid not null references public.projects(id),
  invoice_date date not null,
  tax_enabled boolean not null default false,
  tax_rate numeric(5,4) default 0,
  discount_rate numeric(5,4) default 0,
  subtotal numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references public.employees(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  qty numeric(18,4) not null,
  unit_price numeric(18,2) not null,
  line_total numeric(18,2) not null,
  warehouse_id uuid, -- For Phase 8
  created_at timestamptz default now()
);

-- 3. CLAIMS
CREATE TABLE public.claims (
  id uuid primary key default gen_random_uuid(),
  claim_type text not null check (claim_type in ('vendor', 'owner')),
  party_id uuid not null,
  project_id uuid not null references public.projects(id),
  claim_number int not null,
  claim_date date not null,
  tax_enabled boolean not null default false,
  tax_rate numeric(5,4) default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references public.employees(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (claim_type, party_id, project_id, claim_number)
);

CREATE TABLE public.claim_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  item_ref uuid not null,
  description text not null,
  previous_qty numeric(18,4) not null default 0,
  current_qty numeric(18,4) not null,
  unit_price numeric(18,2) not null,
  disbursement_pct numeric(5,4) not null default 1.0,
  line_total numeric(18,2) not null,
  is_stock_issue boolean not null default false,
  warehouse_id uuid,
  created_at timestamptz default now()
);

CREATE TABLE public.retention_releases (
  id uuid primary key default gen_random_uuid(),
  claim_type text not null check (claim_type in ('vendor', 'owner')),
  party_id uuid not null,
  project_id uuid not null references public.projects(id),
  amount numeric(18,2) not null,
  released_by uuid not null references public.employees(id),
  released_at timestamptz default now(),
  notes text,
  created_at timestamptz default now()
);

-- INDEXES
CREATE INDEX idx_invoices_vendor ON public.invoices(vendor_id);
CREATE INDEX idx_invoices_project ON public.invoices(project_id);
CREATE INDEX idx_claims_party ON public.claims(party_id);
CREATE INDEX idx_claims_project ON public.claims(project_id);
CREATE INDEX idx_claim_items_ref ON public.claim_items(item_ref);
CREATE INDEX idx_invoice_items_invoice ON public.invoice_items(invoice_id);
CREATE INDEX idx_claim_items_claim ON public.claim_items(claim_id);

-- 4. TRIGGERS
CREATE OR REPLACE FUNCTION public.trg_update_invoice_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_subtotal numeric(18,2);
  v_discount_rate numeric(5,4);
  v_tax_rate numeric(5,4);
  v_tax_enabled boolean;
  v_discount_amount numeric(18,2);
  v_tax_amount numeric(18,2);
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal
  FROM public.invoice_items
  WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT discount_rate, tax_rate, tax_enabled 
  INTO v_discount_rate, v_tax_rate, v_tax_enabled
  FROM public.invoices 
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  v_discount_amount := v_subtotal * v_discount_rate;
  IF v_tax_enabled THEN
    v_tax_amount := (v_subtotal - v_discount_amount) * v_tax_rate;
  ELSE
    v_tax_amount := 0;
  END IF;

  UPDATE public.invoices
  SET 
    subtotal = v_subtotal,
    discount_amount = v_discount_amount,
    tax_amount = v_tax_amount,
    total = v_subtotal - v_discount_amount + v_tax_amount
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_invoice_totals_after_item_change
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.trg_update_invoice_totals();

CREATE OR REPLACE FUNCTION public.trg_update_invoice_totals_on_invoice()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.discount_rate IS DISTINCT FROM OLD.discount_rate OR 
     NEW.tax_rate IS DISTINCT FROM OLD.tax_rate OR
     NEW.tax_enabled IS DISTINCT FROM OLD.tax_enabled THEN
     
     NEW.discount_amount := NEW.subtotal * NEW.discount_rate;
     IF NEW.tax_enabled THEN
       NEW.tax_amount := (NEW.subtotal - NEW.discount_amount) * NEW.tax_rate;
     ELSE
       NEW.tax_amount := 0;
     END IF;
     NEW.total := NEW.subtotal - NEW.discount_amount + NEW.tax_amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_invoice_totals_before_invoice_change
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_update_invoice_totals_on_invoice();

-- 5. VIEW
CREATE OR REPLACE VIEW public.v_claim_totals AS
WITH item_math AS (
  SELECT 
    ci.claim_id,
    ci.item_ref,
    ci.previous_qty,
    ci.current_qty,
    ci.unit_price,
    ci.disbursement_pct,
    (ci.previous_qty + ci.current_qty) * ci.unit_price AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct) AS cumulative_retained
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT 
    claim_id,
    SUM(cumulative_line_total) as claim_cumulative_total,
    SUM(cumulative_payable) as claim_cumulative_payable,
    SUM(cumulative_retained) as claim_cumulative_retained
  FROM item_math
  GROUP BY claim_id
)
SELECT 
  c.id as claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  COALESCE(
    (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
     FROM public.claims pc
     JOIN public.claim_items pci ON pci.claim_id = pc.id
     WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
     GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
    ), 0
  ) as prior_cumulative_payable,
  (cs.claim_cumulative_payable - COALESCE(
    (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
     FROM public.claims pc
     JOIN public.claim_items pci ON pci.claim_id = pc.id
     WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
     GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
    ), 0
  )) as net_payable_before_tax,
  CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable - COALESCE(
      (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
       FROM public.claims pc
       JOIN public.claim_items pci ON pci.claim_id = pc.id
       WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
       GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
      ), 0
    )) * c.tax_rate
  ELSE 0 END as tax_amount,
  (cs.claim_cumulative_payable - COALESCE(
    (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
     FROM public.claims pc
     JOIN public.claim_items pci ON pci.claim_id = pc.id
     WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
     GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
    ), 0
  )) + CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable - COALESCE(
      (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
       FROM public.claims pc
       JOIN public.claim_items pci ON pci.claim_id = pc.id
       WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
       GROUP BY pc.claim_number ORDER BY pc.claim_number DESC LIMIT 1
      ), 0
    )) * c.tax_rate
  ELSE 0 END as total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs ON cs.claim_id = c.id;

-- 6. RPCs
CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve invoices';
  END IF;

  SELECT status INTO v_status FROM public.invoices WHERE id = p_invoice_id;
  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'approved', approved_by = public.current_employee_id(), approved_at = now()
  WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_invoice(p_invoice_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject invoices';
  END IF;

  UPDATE public.invoices
  SET status = 'rejected'
  WHERE id = p_invoice_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  SELECT status INTO v_status FROM public.claims WHERE id = p_claim_id;
  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'approved', approved_by = public.current_employee_id(), approved_at = now()
  WHERE id = p_claim_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_claim(p_claim_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject claims';
  END IF;

  UPDATE public.claims
  SET status = 'rejected'
  WHERE id = p_claim_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RLS
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_project_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors viewable if all projects or project access matches" ON public.vendors
  FOR SELECT TO authenticated USING (
    all_projects = true
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.vendor_project_access vpa
      WHERE vpa.vendor_id = id AND public.has_project_access(vpa.project_id)
    )
  );

CREATE POLICY "Vendors insertable by admins" ON public.vendors
  FOR ALL TO authenticated USING (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()));

CREATE POLICY "Vendor access viewable by matching projects" ON public.vendor_project_access
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Vendor access insertable by admins" ON public.vendor_project_access
  FOR ALL TO authenticated USING (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()));

CREATE POLICY "Invoices select scoped" ON public.invoices
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Invoices insert scoped" ON public.invoices
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Invoice items select scoped" ON public.invoice_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND (public.is_super_admin() OR public.has_project_access(i.project_id)))
  );

CREATE POLICY "Invoice items insert scoped" ON public.invoice_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND (public.is_super_admin() OR public.has_project_access(i.project_id)))
  );

CREATE POLICY "Claims select scoped" ON public.claims
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Claims insert scoped" ON public.claims
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Claim items select scoped" ON public.claim_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.claims c WHERE c.id = claim_id AND (public.is_super_admin() OR public.has_project_access(c.project_id)))
  );

CREATE POLICY "Claim items insert scoped" ON public.claim_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.claims c WHERE c.id = claim_id AND (public.is_super_admin() OR public.has_project_access(c.project_id)))
  );

CREATE POLICY "Retention select scoped" ON public.retention_releases
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Retention insert scoped" ON public.retention_releases
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin() OR public.has_project_access(project_id));

-- ============================================================
-- FILE: 0009_phase5_hardening.sql
-- ============================================================
-- 0009_phase5_hardening.sql

-- 1. Create payment_allocations table (minimal for Phase 7)
CREATE TABLE public.payment_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id uuid REFERENCES public.claims(id) ON DELETE CASCADE,
    allocated_amount numeric(18,2) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allocations viewable by all authenticated" ON public.payment_allocations FOR SELECT TO authenticated USING (true);

-- 2. Create v_claim_paid view
CREATE OR REPLACE VIEW public.v_claim_paid WITH (security_invoker = true) AS
SELECT 
    c.id as claim_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.claims c
LEFT JOIN public.payment_allocations pa ON pa.claim_id = c.id
GROUP BY c.id;

-- 3. Update v_claim_totals with security_invoker = true and LATERAL optimization
CREATE OR REPLACE VIEW public.v_claim_totals WITH (security_invoker = true) AS
WITH item_math AS (
  SELECT 
    ci.claim_id,
    ci.item_ref,
    ci.previous_qty,
    ci.current_qty,
    ci.unit_price,
    ci.disbursement_pct,
    (ci.previous_qty + ci.current_qty) * ci.unit_price AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct) AS cumulative_retained
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT 
    claim_id,
    SUM(cumulative_line_total) as claim_cumulative_total,
    SUM(cumulative_payable) as claim_cumulative_payable,
    SUM(cumulative_retained) as claim_cumulative_retained
  FROM item_math
  GROUP BY claim_id
)
SELECT 
  c.id as claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  COALESCE(prior.amount, 0) as prior_cumulative_payable,
  (cs.claim_cumulative_payable - COALESCE(prior.amount, 0)) as net_payable_before_tax,
  CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable - COALESCE(prior.amount, 0)) * c.tax_rate
  ELSE 0 END as tax_amount,
  (cs.claim_cumulative_payable - COALESCE(prior.amount, 0)) + CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable - COALESCE(prior.amount, 0)) * c.tax_rate
  ELSE 0 END as total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs ON cs.claim_id = c.id
LEFT JOIN LATERAL (
  SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct) as amount
  FROM public.claims pc
  JOIN public.claim_items pci ON pci.claim_id = pc.id
  WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
) prior ON true;

-- 4. Replace RPCs to add project scoping and auditing
CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_project_id uuid;
BEGIN
  SELECT status, project_id INTO v_status, v_project_id FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve invoices';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'approved', approved_by = public.current_employee_id(), approved_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (public.current_employee_id(), 'approve', 'invoice', p_invoice_id, jsonb_build_object('status', 'approved'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_project_id uuid;
BEGIN
  SELECT status, project_id INTO v_status, v_project_id FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject invoices';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'rejected'
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (public.current_employee_id(), 'reject', 'invoice', p_invoice_id, jsonb_build_object('status', 'rejected'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_project_id uuid;
BEGIN
  SELECT status, project_id INTO v_status, v_project_id FROM public.claims WHERE id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'approved', approved_by = public.current_employee_id(), approved_at = now()
  WHERE id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (public.current_employee_id(), 'approve', 'claim', p_claim_id, jsonb_build_object('status', 'approved'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_project_id uuid;
BEGIN
  SELECT status, project_id INTO v_status, v_project_id FROM public.claims WHERE id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject claims';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'rejected'
  WHERE id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (public.current_employee_id(), 'reject', 'claim', p_claim_id, jsonb_build_object('status', 'rejected'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Release Retention RPC
CREATE OR REPLACE FUNCTION public.release_retention(p_claim_id uuid, p_amount numeric, p_notes text)
RETURNS uuid AS $$
DECLARE
    v_project_id uuid;
    v_status text;
    v_retention_id uuid;
BEGIN
    SELECT project_id, status INTO v_project_id, v_status FROM public.claims WHERE id = p_claim_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
    IF v_status != 'approved' THEN RAISE EXCEPTION 'Claim must be approved to release retention'; END IF;

    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to release retention';
    END IF;

    IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized on this project';
    END IF;

    INSERT INTO public.retention_releases (claim_id, release_date, release_amount, notes, status, created_by)
    VALUES (p_claim_id, CURRENT_DATE, p_amount, p_notes, 'pending', public.current_employee_id())
    RETURNING id INTO v_retention_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'retention_release', v_retention_id, jsonb_build_object('claim_id', p_claim_id, 'amount', p_amount));

    RETURN v_retention_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update retention RLS policy
DROP POLICY IF EXISTS "Retention insert scoped" ON public.retention_releases;
CREATE POLICY "Retention insert scoped" ON public.retention_releases
  FOR INSERT TO authenticated WITH CHECK (
    (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
    AND (public.is_super_admin() OR public.has_project_access(project_id))
  );

-- ============================================================
-- FILE: 0010_phase6_owner_income.sql
-- ============================================================
-- 0010_phase6_owner_income.sql

-- 1. Create owner_payment_schedule table
CREATE TABLE public.owner_payment_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  expected_amount numeric(18,2) NOT NULL,
  method text,
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'partial', 'paid')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. RLS for owner_payment_schedule
ALTER TABLE public.owner_payment_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_payment_schedule select scoped" ON public.owner_payment_schedule
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "owner_payment_schedule insert scoped" ON public.owner_payment_schedule
  FOR INSERT TO authenticated WITH CHECK (
    (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
    AND (public.is_super_admin() OR public.has_project_access(project_id))
  );

CREATE POLICY "owner_payment_schedule update scoped" ON public.owner_payment_schedule
  FOR UPDATE TO authenticated USING (
    (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
    AND (public.is_super_admin() OR public.has_project_access(project_id))
  );

CREATE POLICY "owner_payment_schedule delete scoped" ON public.owner_payment_schedule
  FOR DELETE TO authenticated USING (
    (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
    AND (public.is_super_admin() OR public.has_project_access(project_id))
  );

-- 3. Trigger to prevent owner claims on main company
CREATE OR REPLACE FUNCTION public.trg_prevent_main_company_owner_claims()
RETURNS TRIGGER AS $$
DECLARE
  v_node_type text;
BEGIN
  IF NEW.claim_type = 'owner' THEN
    SELECT node_type INTO v_node_type FROM public.projects WHERE id = NEW.project_id;
    IF v_node_type = 'main_company' THEN
      RAISE EXCEPTION 'Cannot create an owner claim on the main company node.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER prevent_main_company_owner_claims
BEFORE INSERT OR UPDATE ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_main_company_owner_claims();

-- 4. Re-create v_project_financial_position with real numbers
DROP VIEW IF EXISTS public.v_project_financial_position;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
SELECT 
  p.id as project_id,
  -- Income = Sum of total_due_this_claim for approved owner claims
  COALESCE((
    SELECT SUM(vct.total_due_this_claim) 
    FROM public.claims c 
    JOIN public.v_claim_totals vct ON c.id = vct.claim_id 
    WHERE c.project_id = p.id AND c.claim_type = 'owner' AND c.status = 'approved'
  ), 0) as total_income,
  
  -- Expenses = Sum of approved invoices (total) + Sum of approved vendor claims (total_due_this_claim)
  (
    COALESCE((
      SELECT SUM(total) 
      FROM public.invoices 
      WHERE project_id = p.id AND status = 'approved'
    ), 0) 
    +
    COALESCE((
      SELECT SUM(vct.total_due_this_claim) 
      FROM public.claims c 
      JOIN public.v_claim_totals vct ON c.id = vct.claim_id 
      WHERE c.project_id = p.id AND c.claim_type = 'vendor' AND c.status = 'approved'
    ), 0)
  ) as total_expenses,
  
  -- Balance = Income - Expenses
  (
    COALESCE((
      SELECT SUM(vct.total_due_this_claim) 
      FROM public.claims c 
      JOIN public.v_claim_totals vct ON c.id = vct.claim_id 
      WHERE c.project_id = p.id AND c.claim_type = 'owner' AND c.status = 'approved'
    ), 0)
    -
    (
      COALESCE((
        SELECT SUM(total) 
        FROM public.invoices 
        WHERE project_id = p.id AND status = 'approved'
      ), 0) 
      +
      COALESCE((
        SELECT SUM(vct.total_due_this_claim) 
        FROM public.claims c 
        JOIN public.v_claim_totals vct ON c.id = vct.claim_id 
        WHERE c.project_id = p.id AND c.claim_type = 'vendor' AND c.status = 'approved'
      ), 0)
    )
  ) as balance
FROM public.projects p;

-- ============================================================
-- FILE: 0011_phase6_hardening.sql
-- ============================================================
-- 0011_phase6_hardening.sql

-- FIX 1: rewrite release_retention to use correct columns of retention_releases
CREATE OR REPLACE FUNCTION public.release_retention(p_claim_id uuid, p_amount numeric, p_notes text)
RETURNS uuid AS $$
DECLARE
    v_project_id uuid;
    v_status text;
    v_claim_type text;
    v_party_id uuid;
    v_retention_id uuid;
BEGIN
    SELECT project_id, status, claim_type, party_id 
    INTO v_project_id, v_status, v_claim_type, v_party_id 
    FROM public.claims WHERE id = p_claim_id;
    
    IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
    IF v_status != 'approved' THEN RAISE EXCEPTION 'Claim must be approved to release retention'; END IF;

    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to release retention';
    END IF;

    IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized on this project';
    END IF;

    INSERT INTO public.retention_releases (claim_type, party_id, project_id, amount, released_by, notes)
    VALUES (v_claim_type, v_party_id, v_project_id, p_amount, public.current_employee_id(), p_notes)
    RETURNING id INTO v_retention_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'retention_release', v_retention_id, jsonb_build_object('claim_id', p_claim_id, 'amount', p_amount));

    RETURN v_retention_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FIX 4: Add set_updated_at trigger to owner_payment_schedule
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.owner_payment_schedule
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- FILE: 0012_phase7_treasury_payments.sql
-- ============================================================
-- 0012_phase7_treasury_payments.sql

-- 1. Redefine payment_allocations to be polymorphic and link to ledger_entries
DROP VIEW IF EXISTS public.v_claim_paid CASCADE;
DROP TABLE IF EXISTS public.payment_allocations CASCADE;

CREATE TABLE public.payment_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_entry_id uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE CASCADE,
    target_type text NOT NULL CHECK (target_type IN ('invoice', 'claim', 'retention_release', 'owner_schedule')),
    target_id uuid NOT NULL,
    allocated_amount numeric(18,2) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allocations viewable by all authenticated" ON public.payment_allocations FOR SELECT TO authenticated USING (true);

-- 2. Create Views for Paid Amounts
CREATE OR REPLACE VIEW public.v_claim_paid WITH (security_invoker = true) AS
SELECT 
    c.id as claim_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.claims c
LEFT JOIN public.payment_allocations pa ON pa.target_id = c.id AND pa.target_type = 'claim'
GROUP BY c.id;

CREATE OR REPLACE VIEW public.v_invoice_paid WITH (security_invoker = true) AS
SELECT 
    i.id as invoice_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.invoices i
LEFT JOIN public.payment_allocations pa ON pa.target_id = i.id AND pa.target_type = 'invoice'
GROUP BY i.id;

CREATE OR REPLACE VIEW public.v_retention_paid WITH (security_invoker = true) AS
SELECT 
    r.id as retention_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.retention_releases r
LEFT JOIN public.payment_allocations pa ON pa.target_id = r.id AND pa.target_type = 'retention_release'
GROUP BY r.id;

CREATE OR REPLACE VIEW public.v_owner_schedule_paid WITH (security_invoker = true) AS
SELECT 
    s.id as schedule_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.owner_payment_schedule s
LEFT JOIN public.payment_allocations pa ON pa.target_id = s.id AND pa.target_type = 'owner_schedule'
GROUP BY s.id;

-- 3. Account Statements Views
CREATE OR REPLACE VIEW public.v_vendor_account WITH (security_invoker = true) AS
WITH vendor_docs AS (
    -- Invoices
    SELECT 
        i.vendor_id as party_id, i.project_id, i.invoice_date as document_date, 
        'invoice' as document_type, i.id as document_id, 
        ('Invoice #' || i.id::text) as description, 
        i.total as amount_due, 0 as amount_paid,
        i.created_at
    FROM public.invoices i
    WHERE i.status = 'approved'
    
    UNION ALL
    
    -- Vendor Claims
    SELECT 
        c.party_id, c.project_id, c.claim_date as document_date, 
        'claim' as document_type, c.id as document_id, 
        ('Vendor Claim #' || c.claim_number::text) as description, 
        (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id) as amount_due, 
        0 as amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved' AND c.claim_type = 'vendor'

    UNION ALL
    
    -- Retention Releases
    SELECT 
        r.party_id, r.project_id, r.released_at::date as document_date, 
        'retention_release' as document_type, r.id as document_id, 
        'Retention Release' as description, 
        r.amount as amount_due, 
        0 as amount_paid,
        r.created_at
    FROM public.retention_releases r
    WHERE r.claim_type = 'vendor'

    UNION ALL
    
    -- Ledger Entries (Payments)
    SELECT 
        le.counterparty_id as party_id, le.project_id, le.entry_date as document_date, 
        'payment' as document_type, le.id as document_id, 
        COALESCE(le.memo, 'Payment') as description, 
        0 as amount_due, 
        le.amount as amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'vendor' AND le.direction = 'out'
)
SELECT 
    d.party_id,
    d.project_id,
    p.name as project_name,
    d.document_date,
    d.document_type,
    d.document_id,
    d.description,
    d.amount_due,
    d.amount_paid,
    d.created_at,
    SUM(d.amount_due - d.amount_paid) OVER (
        PARTITION BY d.party_id 
        ORDER BY d.document_date ASC, d.created_at ASC
    ) as running_balance
FROM vendor_docs d
LEFT JOIN public.projects p ON d.project_id = p.id;

CREATE OR REPLACE VIEW public.v_owner_account WITH (security_invoker = true) AS
WITH owner_docs AS (
    -- Owner Claims
    SELECT 
        c.party_id, c.project_id, c.claim_date as document_date, 
        'claim' as document_type, c.id as document_id, 
        ('Owner Claim #' || c.claim_number::text) as description, 
        (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id) as amount_due, 
        0 as amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved' AND c.claim_type = 'owner'
    
    UNION ALL

    -- Ledger Entries (Receipts)
    SELECT 
        le.counterparty_id as party_id, le.project_id, le.entry_date as document_date, 
        'receipt' as document_type, le.id as document_id, 
        COALESCE(le.memo, 'Receipt') as description, 
        0 as amount_due, 
        le.amount as amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'owner' AND le.direction = 'in'
)
SELECT 
    d.party_id,
    d.project_id,
    p.name as project_name,
    d.document_date,
    d.document_type,
    d.document_id,
    d.description,
    d.amount_due,
    d.amount_paid,
    d.created_at,
    SUM(d.amount_due - d.amount_paid) OVER (
        PARTITION BY d.party_id 
        ORDER BY d.document_date ASC, d.created_at ASC
    ) as running_balance
FROM owner_docs d
LEFT JOIN public.projects p ON d.project_id = p.id;

-- 4. Update v_project_financial_position to include cash
DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;
CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
SELECT 
    p.id AS project_id,
    p.name,
    p.code,
    
    -- Billed Income (Owner claims approved)
    COALESCE(SUM(
        CASE WHEN c.claim_type = 'owner' AND c.status = 'approved' THEN
            (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
        ELSE 0 END
    ), 0) AS total_income,
    
    -- Cash Received (Ledger entries in from owner)
    COALESCE((
        SELECT SUM(le.amount) 
        FROM public.ledger_entries le 
        WHERE le.project_id = p.id AND le.counterparty_type = 'owner' AND le.direction = 'in'
    ), 0) AS total_received,

    -- Billed Expense (Vendor claims approved + Invoices approved)
    COALESCE(SUM(
        CASE WHEN c.claim_type = 'vendor' AND c.status = 'approved' THEN
            (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
        ELSE 0 END
    ), 0) + 
    COALESCE((
        SELECT SUM(i.total) 
        FROM public.invoices i 
        WHERE i.project_id = p.id AND i.status = 'approved'
    ), 0) AS total_expenses,
    
    -- Cash Paid (Ledger entries out to vendor)
    COALESCE((
        SELECT SUM(le.amount) 
        FROM public.ledger_entries le 
        WHERE le.project_id = p.id AND le.counterparty_type = 'vendor' AND le.direction = 'out'
    ), 0) AS total_paid,

    -- Retention Held
    COALESCE(SUM(
        CASE WHEN c.claim_type = 'vendor' AND c.status = 'approved' THEN
            (SELECT claim_cumulative_retained FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
        ELSE 0 END
    ), 0) -
    COALESCE((
        SELECT SUM(r.amount)
        FROM public.retention_releases r
        WHERE r.project_id = p.id AND r.claim_type = 'vendor'
    ), 0) AS retention_held,

    -- Balance (Billed Income - Billed Expense)
    COALESCE(SUM(
        CASE WHEN c.claim_type = 'owner' AND c.status = 'approved' THEN
            (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
        ELSE 0 END
    ), 0) - 
    (
      COALESCE(SUM(
          CASE WHEN c.claim_type = 'vendor' AND c.status = 'approved' THEN
              (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
          ELSE 0 END
      ), 0) + 
      COALESCE((
          SELECT SUM(i.total) 
          FROM public.invoices i 
          WHERE i.project_id = p.id AND i.status = 'approved'
      ), 0)
    ) AS balance

FROM public.projects p
LEFT JOIN public.claims c ON c.project_id = p.id
GROUP BY p.id, p.name, p.code;

-- 5. RPCs for Recording Payments & Receipts
CREATE OR REPLACE FUNCTION public.record_vendor_payment(
    p_bank_account_id uuid,
    p_vendor_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb -- Array of { target_type, target_id, amount }
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
BEGIN
    -- Authorization
    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        -- TODO: or has_page_access('treasury')
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    -- Validate allocations sum <= amount
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_total_allocated := v_total_allocated + (v_alloc->>'amount')::numeric;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed payment amount';
    END IF;

    -- Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'out', p_amount, 'vendor_payment', p_bank_account_id, 'vendor', p_vendor_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        IF (v_alloc->>'amount')::numeric > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_alloc->>'target_type', (v_alloc->>'target_id')::uuid, (v_alloc->>'amount')::numeric
            );
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'vendor_payment', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.record_owner_receipt(
    p_bank_account_id uuid,
    p_owner_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb -- Array of { target_type, target_id, amount }
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
BEGIN
    -- Authorization
    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to record receipts';
    END IF;

    -- Validate allocations sum <= amount
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_total_allocated := v_total_allocated + (v_alloc->>'amount')::numeric;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed receipt amount';
    END IF;

    -- Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'in', p_amount, 'owner_payment', p_bank_account_id, 'owner', p_owner_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        IF (v_alloc->>'amount')::numeric > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_alloc->>'target_type', (v_alloc->>'target_id')::uuid, (v_alloc->>'amount')::numeric
            );

            -- If target is owner_schedule, we should eventually update its status.
            -- Using a trigger or handling it here.
            IF v_alloc->>'target_type' = 'owner_schedule' THEN
                -- We'll just set it to 'partial' or 'paid' based on sum.
                -- For now, let's let the application or view handle this or do a quick update.
                -- Phase 7 says "update owner_payment_schedule.status (expected->partial->paid)"
                UPDATE public.owner_payment_schedule ops
                SET status = CASE 
                    WHEN (SELECT COALESCE(SUM(allocated_amount), 0) FROM public.payment_allocations WHERE target_id = ops.id AND target_type = 'owner_schedule') >= ops.expected_amount THEN 'paid'
                    ELSE 'partial'
                END
                WHERE id = (v_alloc->>'target_id')::uuid;
            END IF;
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'owner_receipt', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Aggregated Balances for Dashboards
CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
SELECT 
    v.id AS vendor_id,
    v.name AS vendor_name,
    COALESCE(SUM(va.amount_due), 0) AS total_due,
    COALESCE(SUM(va.amount_paid), 0) AS total_paid,
    COALESCE(SUM(va.amount_due) - SUM(va.amount_paid), 0) AS balance
FROM public.vendors v
LEFT JOIN public.v_vendor_account va ON va.party_id = v.id
GROUP BY v.id, v.name;

CREATE OR REPLACE VIEW public.v_owner_balances WITH (security_invoker = true) AS
SELECT 
    o.id AS owner_id,
    o.name AS owner_name,
    COALESCE(SUM(oa.amount_due), 0) AS total_due,
    COALESCE(SUM(oa.amount_paid), 0) AS total_paid,
    COALESCE(SUM(oa.amount_due) - SUM(oa.amount_paid), 0) AS balance
FROM public.project_owners o
LEFT JOIN public.v_owner_account oa ON oa.party_id = o.id
GROUP BY o.id, o.name;

-- ============================================================
-- FILE: 0013_phase7_hardening.sql
-- ============================================================
-- 0013_phase7_hardening.sql

-- FIX 1 & 6: Rewrite v_project_financial_position to derive cash from allocations and optimize claim totals
DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;
CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT 
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT 
        project_id,
        SUM(CASE WHEN claim_type = 'owner' THEN total_due_this_claim ELSE 0 END) as owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim ELSE 0 END) as vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) as vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) as invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) as retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) as total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
    UNION ALL
    SELECT c.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
    UNION ALL
    SELECT r.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
),
vendor_cash AS (
    SELECT project_id, SUM(amount) as total_paid
    FROM vendor_allocations
    GROUP BY project_id
)
SELECT 
    p.id AS project_id,
    p.name,
    p.code,
    COALESCE(pca.owner_billed, 0) AS total_income,
    COALESCE(oc.total_received, 0) AS total_received,
    COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) AS total_expenses,
    COALESCE(vc.total_paid, 0) AS total_paid,
    COALESCE(pca.vendor_retained, 0) - COALESCE(rra.retention_released, 0) AS retention_held,
    COALESCE(pca.owner_billed, 0) - (COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0)) AS balance
FROM public.projects p
LEFT JOIN proj_claims_agg pca ON pca.project_id = p.id
LEFT JOIN invoices_agg ia ON ia.project_id = p.id
LEFT JOIN retention_releases_agg rra ON rra.project_id = p.id
LEFT JOIN owner_cash oc ON oc.project_id = p.id
LEFT JOIN vendor_cash vc ON vc.project_id = p.id;

-- FIX 2, 3, 4: Hardened record_vendor_payment
CREATE OR REPLACE FUNCTION public.record_vendor_payment(
    p_bank_account_id uuid,
    p_vendor_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb -- Array of { target_type, target_id, amount }
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
    v_target_id uuid;
    v_alloc_amount numeric;
    v_target_type text;
    
    v_doc_project_id uuid;
    v_doc_party_id uuid;
    v_doc_due numeric;
    v_doc_paid numeric;
BEGIN
    -- Authorization: Super admin or has treasury access
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    -- Pre-scan allocations for validity, party ownership, bounds, and project access
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount <= 0 THEN CONTINUE; END IF;
        
        v_total_allocated := v_total_allocated + v_alloc_amount;
        v_target_id := (v_alloc->>'target_id')::uuid;
        v_target_type := v_alloc->>'target_type';

        IF v_target_type = 'invoice' THEN
            SELECT vendor_id, project_id, total, (SELECT paid_amount FROM public.v_invoice_paid WHERE invoice_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.invoices WHERE id = v_target_id;
        ELSIF v_target_type = 'claim' THEN
            SELECT party_id, project_id, (SELECT total_due_this_claim FROM public.v_claim_totals WHERE claim_id = v_target_id), (SELECT paid_amount FROM public.v_claim_paid WHERE claim_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.claims WHERE id = v_target_id AND claim_type = 'vendor';
        ELSIF v_target_type = 'retention_release' THEN
            SELECT party_id, project_id, amount, (SELECT paid_amount FROM public.v_retention_paid WHERE retention_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.retention_releases WHERE id = v_target_id AND claim_type = 'vendor';
        ELSE
            RAISE EXCEPTION 'Invalid target_type for vendor payment: %', v_target_type;
        END IF;

        IF v_doc_party_id IS NULL THEN RAISE EXCEPTION 'Document % not found or invalid type', v_target_id; END IF;
        IF v_doc_party_id != p_vendor_id THEN RAISE EXCEPTION 'Document % does not belong to vendor %', v_target_id, p_vendor_id; END IF;
        
        -- Project access check
        IF NOT public.is_super_admin() AND NOT public.has_project_access(v_doc_project_id) THEN
            RAISE EXCEPTION 'Not authorized to allocate against project %', v_doc_project_id;
        END IF;

        -- Allocation bounds check
        IF v_alloc_amount > (v_doc_due - COALESCE(v_doc_paid, 0)) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %', v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed payment amount';
    END IF;

    -- Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'out', p_amount, 'vendor_payment', p_bank_account_id, 'vendor', p_vendor_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_alloc->>'target_type', (v_alloc->>'target_id')::uuid, v_alloc_amount
            );
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'vendor_payment', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FIX 2, 3, 4: Hardened record_owner_receipt
CREATE OR REPLACE FUNCTION public.record_owner_receipt(
    p_bank_account_id uuid,
    p_owner_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb -- Array of { target_type, target_id, amount }
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
    v_target_id uuid;
    v_alloc_amount numeric;
    v_target_type text;
    
    v_doc_project_id uuid;
    v_doc_party_id uuid;
    v_doc_due numeric;
    v_doc_paid numeric;
BEGIN
    -- Authorization
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to record receipts';
    END IF;

    -- Pre-scan allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount <= 0 THEN CONTINUE; END IF;
        
        v_total_allocated := v_total_allocated + v_alloc_amount;
        v_target_id := (v_alloc->>'target_id')::uuid;
        v_target_type := v_alloc->>'target_type';

        IF v_target_type = 'claim' THEN
            SELECT party_id, project_id, (SELECT total_due_this_claim FROM public.v_claim_totals WHERE claim_id = v_target_id), (SELECT paid_amount FROM public.v_claim_paid WHERE claim_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.claims WHERE id = v_target_id AND claim_type = 'owner';
        ELSIF v_target_type = 'owner_schedule' THEN
            SELECT po.id, s.project_id, s.expected_amount, (SELECT paid_amount FROM public.v_owner_schedule_paid WHERE schedule_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.owner_payment_schedule s
            JOIN public.projects p ON p.id = s.project_id
            JOIN public.project_owners po ON po.id = p.owner_id
            WHERE s.id = v_target_id;
        ELSE
            RAISE EXCEPTION 'Invalid target_type for owner receipt: %', v_target_type;
        END IF;

        IF v_doc_party_id IS NULL THEN RAISE EXCEPTION 'Document % not found or invalid type', v_target_id; END IF;
        IF v_doc_party_id != p_owner_id THEN RAISE EXCEPTION 'Document % does not belong to owner %', v_target_id, p_owner_id; END IF;
        
        -- Project access check
        IF NOT public.is_super_admin() AND NOT public.has_project_access(v_doc_project_id) THEN
            RAISE EXCEPTION 'Not authorized to allocate against project %', v_doc_project_id;
        END IF;

        -- Allocation bounds check
        IF v_alloc_amount > (v_doc_due - COALESCE(v_doc_paid, 0)) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %', v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed receipt amount';
    END IF;

    -- Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'in', p_amount, 'owner_payment', p_bank_account_id, 'owner', p_owner_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        v_target_id := (v_alloc->>'target_id')::uuid;
        v_target_type := v_alloc->>'target_type';
        IF v_alloc_amount > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_target_type, v_target_id, v_alloc_amount
            );

            IF v_target_type = 'owner_schedule' THEN
                UPDATE public.owner_payment_schedule ops
                SET status = CASE 
                    WHEN (SELECT COALESCE(SUM(allocated_amount), 0) FROM public.payment_allocations WHERE target_id = ops.id AND target_type = 'owner_schedule') >= ops.expected_amount THEN 'paid'
                    ELSE 'partial'
                END
                WHERE id = v_target_id;
            END IF;
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'owner_receipt', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FIX 5: Scope payment_allocations
DROP POLICY IF EXISTS "Allocations viewable by all authenticated" ON public.payment_allocations;
CREATE POLICY "Allocations viewable by all authenticated" ON public.payment_allocations 
FOR SELECT TO authenticated USING (
    public.is_super_admin() OR public.has_page_access('treasury')
);

-- ============================================================
-- FILE: 0014_phase8_inventory.sql
-- ============================================================
-- 0014_phase8_inventory.sql

-- 1. Tables
CREATE TABLE public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  project_id uuid references public.projects(id), -- null means main company warehouse
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  unit text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type text not null check (movement_type in ('in_invoice', 'transfer_out', 'transfer_in', 'issue', 'adjust')),
  qty numeric(18,4) not null, 
  unit_price numeric(18,2),
  reference_id uuid,
  notes text,
  created_by uuid references public.employees(id),
  created_at timestamptz default now()
);

CREATE INDEX idx_stock_movements_wh_item ON public.stock_movements(warehouse_id, item_id);

-- 2. Alter existing tables
ALTER TABLE public.invoice_items ADD COLUMN item_id uuid REFERENCES public.inventory_items(id);
ALTER TABLE public.claim_items ADD COLUMN item_id uuid REFERENCES public.inventory_items(id);

ALTER TABLE public.invoice_items ADD CONSTRAINT chk_invoice_item_warehouse CHECK (
    (warehouse_id IS NULL AND item_id IS NULL) OR 
    (warehouse_id IS NOT NULL AND item_id IS NOT NULL) OR
    (warehouse_id IS NULL AND item_id IS NOT NULL)
);

ALTER TABLE public.claim_items ADD CONSTRAINT chk_claim_item_stock_issue CHECK (
    (is_stock_issue = false) OR 
    (is_stock_issue = true AND warehouse_id IS NOT NULL AND item_id IS NOT NULL)
);

-- 3. View
CREATE OR REPLACE VIEW public.v_stock_on_hand WITH (security_invoker = true) AS
SELECT 
  m.warehouse_id,
  m.item_id,
  w.name as warehouse_name,
  w.project_id,
  i.name as item_name,
  i.code as item_code,
  i.unit as item_unit,
  SUM(m.qty) as qty_on_hand
FROM public.stock_movements m
JOIN public.warehouses w ON w.id = m.warehouse_id
JOIN public.inventory_items i ON i.id = m.item_id
GROUP BY m.warehouse_id, m.item_id, w.name, w.project_id, i.name, i.code, i.unit;

-- 4. Modifying approve RPCs to trigger movements
CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_emp_id uuid;
  v_item record;
BEGIN
  v_emp_id := public.current_employee_id();
  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve invoices';
  END IF;

  SELECT status INTO v_status FROM public.invoices WHERE id = p_invoice_id;
  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE id = p_invoice_id;

  -- Generate stock movements for warehouse items
  FOR v_item IN 
    SELECT warehouse_id, item_id, qty, unit_price 
    FROM public.invoice_items 
    WHERE invoice_id = p_invoice_id AND warehouse_id IS NOT NULL AND item_id IS NOT NULL
  LOOP
    INSERT INTO public.stock_movements (
      warehouse_id, item_id, movement_type, qty, unit_price, reference_id, notes, created_by
    ) VALUES (
      v_item.warehouse_id, v_item.item_id, 'in_invoice', v_item.qty, v_item.unit_price, p_invoice_id, 'Invoice receipt', v_emp_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_emp_id uuid;
  v_item record;
  v_on_hand numeric;
BEGIN
  v_emp_id := public.current_employee_id();
  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  SELECT status INTO v_status FROM public.claims WHERE id = p_claim_id;
  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE id = p_claim_id;

  -- Generate stock issue movements
  FOR v_item IN 
    SELECT warehouse_id, item_id, current_qty 
    FROM public.claim_items 
    WHERE claim_id = p_claim_id AND is_stock_issue = true AND warehouse_id IS NOT NULL AND item_id IS NOT NULL
  LOOP
    -- Verify we have enough stock, don't allow silent negative stock
    SELECT COALESCE((SELECT qty_on_hand FROM public.v_stock_on_hand WHERE warehouse_id = v_item.warehouse_id AND item_id = v_item.item_id), 0)
    INTO v_on_hand;

    IF v_on_hand < v_item.current_qty THEN
        RAISE EXCEPTION 'Insufficient stock for item % in warehouse % to issue claim. Have %, need %', v_item.item_id, v_item.warehouse_id, v_on_hand, v_item.current_qty;
    END IF;

    -- Note: issue is negative qty
    INSERT INTO public.stock_movements (
      warehouse_id, item_id, movement_type, qty, reference_id, notes, created_by
    ) VALUES (
      v_item.warehouse_id, v_item.item_id, 'issue', -v_item.current_qty, p_claim_id, 'Owner claim issue', v_emp_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Movement RPCs
CREATE OR REPLACE FUNCTION public.record_stock_transfer(
    p_from_warehouse_id uuid,
    p_to_warehouse_id uuid,
    p_item_id uuid,
    p_qty numeric,
    p_notes text
) RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_on_hand numeric;
BEGIN
    v_emp_id := public.current_employee_id();

    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'Transfer quantity must be > 0';
    END IF;

    -- Check stock
    SELECT COALESCE((SELECT qty_on_hand FROM public.v_stock_on_hand WHERE warehouse_id = p_from_warehouse_id AND item_id = p_item_id), 0)
    INTO v_on_hand;

    IF v_on_hand < p_qty THEN
        RAISE EXCEPTION 'Insufficient stock in source warehouse';
    END IF;

    -- Transfer out
    INSERT INTO public.stock_movements (
        warehouse_id, item_id, movement_type, qty, notes, created_by
    ) VALUES (
        p_from_warehouse_id, p_item_id, 'transfer_out', -p_qty, p_notes, v_emp_id
    );

    -- Transfer in
    INSERT INTO public.stock_movements (
        warehouse_id, item_id, movement_type, qty, notes, created_by
    ) VALUES (
        p_to_warehouse_id, p_item_id, 'transfer_in', p_qty, p_notes, v_emp_id
    );

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'stock_transfer', p_from_warehouse_id, jsonb_build_object('item_id', p_item_id, 'qty', p_qty, 'to_warehouse', p_to_warehouse_id));

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RLS
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Items viewable by all authenticated" ON public.inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Items modifiable by admins" ON public.inventory_items FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Warehouses scoped to projects" ON public.warehouses
FOR SELECT TO authenticated USING (
    project_id IS NULL OR public.is_super_admin() OR public.has_project_access(project_id)
);
CREATE POLICY "Warehouses modifiable by admins" ON public.warehouses FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Movements scoped to warehouse project" ON public.stock_movements
FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = warehouse_id AND (w.project_id IS NULL OR public.is_super_admin() OR public.has_project_access(w.project_id)))
);

CREATE POLICY "Movements insertable by admins" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

-- ============================================================
-- FILE: 0015_phase8_hardening.sql
-- ============================================================
-- 0015_phase8_hardening.sql

-- 1. Restore has_project_access and audit_log to approve_invoice
CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_emp_id uuid;
  v_item record;
  v_project_id uuid;
BEGIN
  v_emp_id := public.current_employee_id();

  SELECT status, project_id INTO v_status, v_project_id FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve invoices';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (v_emp_id, 'approve', 'invoice', p_invoice_id, jsonb_build_object('status', 'approved'));

  -- Phase 8: Generate stock movements for warehouse items
  FOR v_item IN 
    SELECT warehouse_id, item_id, qty, unit_price 
    FROM public.invoice_items 
    WHERE invoice_id = p_invoice_id AND warehouse_id IS NOT NULL AND item_id IS NOT NULL
  LOOP
    INSERT INTO public.stock_movements (
      warehouse_id, item_id, movement_type, qty, unit_price, reference_id, notes, created_by
    ) VALUES (
      v_item.warehouse_id, v_item.item_id, 'in_invoice', v_item.qty, v_item.unit_price, p_invoice_id, 'Invoice receipt', v_emp_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Restore has_project_access and audit_log to approve_claim
CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_emp_id uuid;
  v_item record;
  v_on_hand numeric;
  v_project_id uuid;
BEGIN
  v_emp_id := public.current_employee_id();

  SELECT status, project_id INTO v_status, v_project_id FROM public.claims WHERE id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (v_emp_id, 'approve', 'claim', p_claim_id, jsonb_build_object('status', 'approved'));

  -- Phase 8: Generate stock issue movements
  FOR v_item IN 
    SELECT warehouse_id, item_id, current_qty 
    FROM public.claim_items 
    WHERE claim_id = p_claim_id AND is_stock_issue = true AND warehouse_id IS NOT NULL AND item_id IS NOT NULL
  LOOP
    -- Verify we have enough stock, don't allow silent negative stock
    SELECT COALESCE((SELECT qty_on_hand FROM public.v_stock_on_hand WHERE warehouse_id = v_item.warehouse_id AND item_id = v_item.item_id), 0)
    INTO v_on_hand;

    IF v_on_hand < v_item.current_qty THEN
        RAISE EXCEPTION 'Insufficient stock for item % in warehouse % to issue claim. Have %, need %', v_item.item_id, v_item.warehouse_id, v_on_hand, v_item.current_qty;
    END IF;

    -- Note: issue is negative qty
    INSERT INTO public.stock_movements (
      warehouse_id, item_id, movement_type, qty, reference_id, notes, created_by
    ) VALUES (
      v_item.warehouse_id, v_item.item_id, 'issue', -v_item.current_qty, p_claim_id, 'Owner claim issue', v_emp_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Add authorization checks to record_stock_transfer
CREATE OR REPLACE FUNCTION public.record_stock_transfer(
    p_from_warehouse_id uuid,
    p_to_warehouse_id uuid,
    p_item_id uuid,
    p_qty numeric,
    p_notes text
) RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_on_hand numeric;
    v_from_proj uuid;
    v_to_proj uuid;
BEGIN
    v_emp_id := public.current_employee_id();

    IF p_from_warehouse_id = p_to_warehouse_id THEN
        RAISE EXCEPTION 'Cannot transfer to the same warehouse';
    END IF;

    -- Check project scoping
    SELECT project_id INTO v_from_proj FROM public.warehouses WHERE id = p_from_warehouse_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source warehouse not found'; END IF;
    
    SELECT project_id INTO v_to_proj FROM public.warehouses WHERE id = p_to_warehouse_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Destination warehouse not found'; END IF;

    IF NOT public.is_super_admin() THEN
        IF NOT public.has_page_access('inventory') THEN
            RAISE EXCEPTION 'Not authorized to manage inventory';
        END IF;
        
        IF v_from_proj IS NOT NULL AND NOT public.has_project_access(v_from_proj) THEN
            RAISE EXCEPTION 'Not authorized on source project';
        END IF;
        
        IF v_to_proj IS NOT NULL AND NOT public.has_project_access(v_to_proj) THEN
            RAISE EXCEPTION 'Not authorized on destination project';
        END IF;
    END IF;

    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'Transfer quantity must be > 0';
    END IF;

    -- Check stock
    SELECT COALESCE((SELECT qty_on_hand FROM public.v_stock_on_hand WHERE warehouse_id = p_from_warehouse_id AND item_id = p_item_id), 0)
    INTO v_on_hand;

    IF v_on_hand < p_qty THEN
        RAISE EXCEPTION 'Insufficient stock in source warehouse';
    END IF;

    -- Transfer out
    INSERT INTO public.stock_movements (
        warehouse_id, item_id, movement_type, qty, notes, created_by
    ) VALUES (
        p_from_warehouse_id, p_item_id, 'transfer_out', -p_qty, p_notes, v_emp_id
    );

    -- Transfer in
    INSERT INTO public.stock_movements (
        warehouse_id, item_id, movement_type, qty, notes, created_by
    ) VALUES (
        p_to_warehouse_id, p_item_id, 'transfer_in', p_qty, p_notes, v_emp_id
    );

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'stock_transfer', p_from_warehouse_id, jsonb_build_object('item_id', p_item_id, 'qty', p_qty, 'to_warehouse', p_to_warehouse_id));

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Add updated_at triggers
DROP TRIGGER IF EXISTS set_updated_at_warehouses ON public.warehouses;
CREATE TRIGGER set_updated_at_warehouses
BEFORE UPDATE ON public.warehouses
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_inventory_items ON public.inventory_items;
CREATE TRIGGER set_updated_at_inventory_items
BEFORE UPDATE ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- FILE: 0016_phase9_deposits.sql
-- ============================================================
-- 0016_phase9_deposits.sql

CREATE TABLE public.deposits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    bank_name text NOT NULL, -- Free text, not a foreign key
    description text,
    notes text,
    start_date date NOT NULL,
    term_months integer NOT NULL,
    profit_type text NOT NULL CHECK (profit_type IN ('fixed_total', 'annual_rate')),
    profit_value numeric(18,2) NOT NULL,
    payout_frequency text NOT NULL CHECK (payout_frequency IN ('monthly', 'quarterly', 'semiannual', 'annual', 'at_maturity')),
    principal_amount numeric(18,2) NOT NULL,
    default_bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
    created_by uuid REFERENCES public.employees(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.deposit_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deposit_id uuid NOT NULL REFERENCES public.deposits(id) ON DELETE CASCADE,
    seq integer NOT NULL,
    due_date date NOT NULL,
    expected_amount numeric(18,2) NOT NULL,
    is_collected boolean NOT NULL DEFAULT false,
    collected_amount numeric(18,2),
    collected_date date,
    bank_account_id uuid REFERENCES public.bank_accounts(id),
    ledger_entry_id uuid REFERENCES public.ledger_entries(id),
    created_at timestamptz DEFAULT now()
);

-- Triggers for updated_at
CREATE TRIGGER set_updated_at_deposits
BEFORE UPDATE ON public.deposits
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deposits viewable by all authenticated" ON public.deposits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Deposits modifiable by admins" ON public.deposits FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('deposits'));

CREATE POLICY "Deposit payouts viewable by all authenticated" ON public.deposit_payouts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Deposit payouts modifiable by admins" ON public.deposit_payouts FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('deposits'));


-- Collect RPC
CREATE OR REPLACE FUNCTION public.collect_deposit_payout(
    p_payout_id uuid,
    p_actual_amount numeric,
    p_date date,
    p_bank_account_id uuid,
    p_notes text
)
RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_payout record;
    v_deposit_name text;
    v_ledger_id uuid;
BEGIN
    v_emp_id := public.current_employee_id();

    IF NOT public.is_super_admin() AND NOT public.has_page_access('deposits') THEN
        RAISE EXCEPTION 'Not authorized to collect deposit payouts';
    END IF;

    SELECT * INTO v_payout FROM public.deposit_payouts WHERE id = p_payout_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payout not found';
    END IF;

    IF v_payout.is_collected THEN
        RAISE EXCEPTION 'This payout has already been collected';
    END IF;

    SELECT name INTO v_deposit_name FROM public.deposits WHERE id = v_payout.deposit_id;

    -- Create ledger entry (deposit_collection is IN to the bank account)
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id,
        source_type, source_id, memo, created_by
    ) VALUES (
        p_date, 'in', p_actual_amount, 'deposit_collection', p_bank_account_id,
        'deposit_payout', p_payout_id, 'Collection of ' || v_deposit_name || ' payout #' || v_payout.seq || '. ' || COALESCE(p_notes, ''), v_emp_id
    ) RETURNING id INTO v_ledger_id;

    -- Update payout
    UPDATE public.deposit_payouts
    SET 
        is_collected = true,
        collected_amount = p_actual_amount,
        collected_date = p_date,
        bank_account_id = p_bank_account_id,
        ledger_entry_id = v_ledger_id
    WHERE id = p_payout_id;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'update', 'deposit_payout', p_payout_id, jsonb_build_object(
        'is_collected', true,
        'collected_amount', p_actual_amount,
        'bank_account_id', p_bank_account_id,
        'ledger_entry_id', v_ledger_id
    ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FILE: 0017_phase10_reports.sql
-- ============================================================
-- 0017_phase10_reports.sql
-- Enrich v_project_financial_position with node_type and net_position

DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT 
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT 
        project_id,
        SUM(CASE WHEN claim_type = 'owner' THEN total_due_this_claim ELSE 0 END) as owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim ELSE 0 END) as vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) as vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) as invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) as retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) as total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
    UNION ALL
    SELECT c.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
    UNION ALL
    SELECT r.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
),
vendor_cash AS (
    SELECT project_id, SUM(amount) as total_paid
    FROM vendor_allocations
    GROUP BY project_id
)
SELECT 
    p.id AS project_id,
    p.name,
    p.code,
    p.node_type,
    p.is_main,
    COALESCE(pca.owner_billed, 0) AS total_income,
    COALESCE(oc.total_received, 0) AS total_received,
    COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) AS total_expenses,
    COALESCE(vc.total_paid, 0) AS total_paid,
    COALESCE(pca.vendor_retained, 0) - COALESCE(rra.retention_released, 0) AS retention_held,
    COALESCE(pca.owner_billed, 0) - (COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0)) AS balance,
    COALESCE(pca.owner_billed, 0) - (COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0)) AS net_position
FROM public.projects p
LEFT JOIN proj_claims_agg pca ON pca.project_id = p.id
LEFT JOIN invoices_agg ia ON ia.project_id = p.id
LEFT JOIN retention_releases_agg rra ON rra.project_id = p.id
LEFT JOIN owner_cash oc ON oc.project_id = p.id
LEFT JOIN vendor_cash vc ON vc.project_id = p.id;

-- ============================================================
-- FILE: 0018_phase11_notifications.sql
-- ============================================================
-- 0018_phase11_notifications.sql

-- 1. Notifications Table
CREATE TABLE public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    type text NOT NULL, -- e.g., 'claim_approved', 'expense_submitted'
    title text NOT NULL,
    body text NOT NULL,
    action_url text, -- optional link to click
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now()
);

-- Index for querying unread notifications quickly
CREATE INDEX idx_notifications_employee_unread ON public.notifications(employee_id) WHERE NOT is_read;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only view and update their own notifications
CREATE POLICY "Users can view own notifications" ON public.notifications
    FOR SELECT TO authenticated USING (employee_id = public.current_employee_id());

CREATE POLICY "Users can update own notifications" ON public.notifications
    FOR UPDATE TO authenticated USING (employee_id = public.current_employee_id());

CREATE POLICY "System can insert notifications" ON public.notifications
    FOR INSERT TO authenticated WITH CHECK (true); -- Inserted via service role or security definer usually, but true for now since our API handles it

-- 2. Push Subscriptions Table
CREATE TABLE public.push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Index for fetching subscriptions for a specific user
CREATE INDEX idx_push_subs_employee ON public.push_subscriptions(employee_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own subscriptions
CREATE POLICY "Users can insert own subscriptions" ON public.push_subscriptions
    FOR INSERT TO authenticated WITH CHECK (employee_id = public.current_employee_id());

CREATE POLICY "Users can delete own subscriptions" ON public.push_subscriptions
    FOR DELETE TO authenticated USING (employee_id = public.current_employee_id());

-- The backend needs to read all subscriptions via service_role to send pushes, 
-- but we don't expose SELECT to regular authenticated users to protect privacy.

-- ============================================================
-- FILE: 0019_fix_project_delete_trigger.sql
-- ============================================================
-- 0019_fix_project_delete_trigger.sql
-- Fix: protect_main_company trigger was returning NEW on DELETE operations,
-- but NEW is NULL on DELETE triggers in PostgreSQL â€” this silently cancelled
-- every non-main-company delete. Must return OLD for DELETE, NEW for UPDATE.

CREATE OR REPLACE FUNCTION public.protect_main_company()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_main = true THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'ظ„ط§ ظٹظ…ظƒظ† ط­ط°ظپ ط§ظ„ط´ط±ظƒط© ط§ظ„ط±ط¦ظٹط³ظٹط©';
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'closed' THEN
      RAISE EXCEPTION 'ظ„ط§ ظٹظ…ظƒظ† ط¥ط؛ظ„ط§ظ‚ ط§ظ„ط´ط±ظƒط© ط§ظ„ط±ط¦ظٹط³ظٹط©';
    END IF;
  END IF;

  -- BEFORE DELETE triggers must return OLD (not NEW which is NULL)
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FILE: 0020_phase12_owner_custody.sql
-- ============================================================
-- 0020_phase12_owner_custody.sql
-- Extends the expense and custody systems to support project owners.

-- ============================================================
-- 1. Make expenses.employee_id nullable
-- ============================================================
ALTER TABLE public.expenses ALTER COLUMN employee_id DROP NOT NULL;

-- ============================================================
-- 2. Add owner_id FK to expenses
-- ============================================================
ALTER TABLE public.expenses
  ADD COLUMN owner_id uuid REFERENCES public.project_owners(id) ON DELETE RESTRICT;

-- At least one of employee_id / owner_id must be set
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_party_check
  CHECK (employee_id IS NOT NULL OR owner_id IS NOT NULL);

-- Index for owner expense queries
CREATE INDEX idx_expenses_owner_id ON public.expenses(owner_id);

-- ============================================================
-- 3. Create owner_custody_disbursements table
-- ============================================================
CREATE TABLE public.owner_custody_disbursements (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid        NOT NULL REFERENCES public.project_owners(id) ON DELETE RESTRICT,
  bank_account_id   uuid        NOT NULL REFERENCES public.bank_accounts(id)  ON DELETE RESTRICT,
  amount            numeric(18,2) NOT NULL CHECK (amount > 0),
  disbursement_date date        NOT NULL,
  memo              text        NOT NULL DEFAULT '',
  created_by        uuid        NOT NULL REFERENCES public.employees(id),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_owner_custody_disbursements_owner ON public.owner_custody_disbursements(owner_id);

-- ============================================================
-- 4. RLS for owner_custody_disbursements
-- ============================================================
ALTER TABLE public.owner_custody_disbursements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner custody disbursements: viewable by treasury or admin"
  ON public.owner_custody_disbursements
  FOR SELECT TO authenticated
  USING (public.has_page_access('treasury/custody') OR public.is_super_admin());

CREATE POLICY "Owner custody disbursements: insertable by treasury or admin"
  ON public.owner_custody_disbursements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_page_access('treasury/custody') OR public.is_super_admin());

-- ============================================================
-- 5. Update expenses INSERT policy to also allow admin/approver
--    to create expenses on behalf of owners
-- ============================================================
DROP POLICY IF EXISTS "Expenses insertable by self if custody access" ON public.expenses;

CREATE POLICY "Expenses insertable"
  ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Employee submitting their own expense (must have custody access)
    (
      employee_id IS NOT NULL
      AND employee_id = public.current_employee_id()
      AND (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
    )
    OR
    -- Admin/approver creating an expense on behalf of an owner
    (
      owner_id IS NOT NULL
      AND employee_id IS NULL
      AND (
        (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
        OR public.is_super_admin()
      )
    )
  );

-- ============================================================
-- 6. Update approve_expense RPC to skip settlement for owner expenses
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_expense(p_expense_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id    uuid;
    v_target_employee uuid;
    v_status         text;
    v_can_approve    boolean;
BEGIN
    v_employee_id := public.current_employee_id();

    SELECT can_approve INTO v_can_approve FROM public.employees WHERE id = v_employee_id;
    IF NOT v_can_approve AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to approve expenses';
    END IF;

    SELECT employee_id, status INTO v_target_employee, v_status
    FROM public.expenses WHERE id = p_expense_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
    IF v_status != 'pending' THEN RAISE EXCEPTION 'Expense already processed'; END IF;

    UPDATE public.expenses
    SET status = 'approved', approved_by = v_employee_id, approved_at = now()
    WHERE id = p_expense_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_employee_id, 'approve', 'expense', p_expense_id, jsonb_build_object('status', 'approved'));

    -- Only settle employee custody when the expense belongs to an employee
    IF v_target_employee IS NOT NULL THEN
        PERFORM public.settle_employee_custody(v_target_employee);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. Create disburse_owner_custody RPC
--    Deducts from bank via ledger_entries + records in owner table
-- ============================================================
CREATE OR REPLACE FUNCTION public.disburse_owner_custody(
  p_bank_account_id uuid,
  p_owner_id        uuid,
  p_amount          numeric,
  p_date            date,
  p_memo            text
) RETURNS uuid AS $$
DECLARE
  v_creator_id uuid;
  v_disb_id    uuid;
BEGIN
  IF NOT public.has_page_access('treasury/custody') AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  v_creator_id := public.current_employee_id();

  -- Deduct from the bank account (shows up in bank statement)
  INSERT INTO public.ledger_entries (
    entry_date, direction, amount, category,
    bank_account_id, memo, created_by,
    counterparty_type, counterparty_id
  ) VALUES (
    p_date, 'out', p_amount, 'custody_disbursement',
    p_bank_account_id, p_memo, v_creator_id,
    'owner', p_owner_id
  );

  -- Record in owner custody table (source of truth for balance view)
  INSERT INTO public.owner_custody_disbursements (
    owner_id, bank_account_id, amount, disbursement_date, memo, created_by
  ) VALUES (
    p_owner_id, p_bank_account_id, p_amount, p_date, p_memo, v_creator_id
  ) RETURNING id INTO v_disb_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (
    v_creator_id, 'create', 'owner_custody_disbursement', v_disb_id,
    jsonb_build_object('owner_id', p_owner_id, 'amount', p_amount)
  );

  RETURN v_disb_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. Create v_owner_custody_balance view
-- ============================================================
CREATE OR REPLACE VIEW public.v_owner_custody_balance WITH (security_invoker = true) AS
SELECT
  o.id    AS owner_id,
  o.name,
  COALESCE(disb.total_disbursed, 0)        AS total_disbursed,
  COALESCE(exp.total_approved_expenses, 0) AS total_approved_expenses,
  COALESCE(disb.total_disbursed, 0) - COALESCE(exp.total_approved_expenses, 0) AS balance
FROM public.project_owners o
LEFT JOIN (
  SELECT owner_id, SUM(amount) AS total_disbursed
  FROM public.owner_custody_disbursements
  GROUP BY owner_id
) disb ON o.id = disb.owner_id
LEFT JOIN (
  SELECT owner_id, SUM(amount) AS total_approved_expenses
  FROM public.expenses
  WHERE status = 'approved' AND owner_id IS NOT NULL
  GROUP BY owner_id
) exp ON o.id = exp.owner_id
WHERE disb.total_disbursed IS NOT NULL
   OR exp.total_approved_expenses IS NOT NULL;

-- ============================================================
-- FILE: 0021_patch_owner_custody_fix.sql
-- ============================================================
-- 0021_patch_owner_custody_fix.sql
-- Fix v_owner_custody_balance and owner_custody_disbursements RLS
-- so non-super-admin treasury users can access the page without errors.

-- ============================================================
-- 1. Recreate v_owner_custody_balance as SECURITY DEFINER
--    so it bypasses project_owners RLS and always shows all owners.
--    The page itself is already protected by canSeeTreasury check.
-- ============================================================
DROP VIEW IF EXISTS public.v_owner_custody_balance;

CREATE OR REPLACE VIEW public.v_owner_custody_balance
WITH (security_invoker = false) AS
SELECT
  o.id    AS owner_id,
  o.name,
  COALESCE(disb.total_disbursed,        0) AS total_disbursed,
  COALESCE(exp.total_approved_expenses, 0) AS total_approved_expenses,
  COALESCE(disb.total_disbursed, 0)
    - COALESCE(exp.total_approved_expenses, 0)  AS balance
FROM public.project_owners o
LEFT JOIN (
  SELECT owner_id, SUM(amount) AS total_disbursed
  FROM public.owner_custody_disbursements
  GROUP BY owner_id
) disb ON o.id = disb.owner_id
LEFT JOIN (
  SELECT owner_id, SUM(amount) AS total_approved_expenses
  FROM public.expenses
  WHERE status = 'approved' AND owner_id IS NOT NULL
  GROUP BY owner_id
) exp ON o.id = exp.owner_id
WHERE disb.total_disbursed IS NOT NULL
   OR exp.total_approved_expenses IS NOT NULL;

-- Grant access to authenticated users
GRANT SELECT ON public.v_owner_custody_balance TO authenticated;

-- ============================================================
-- 2. Relax owner_custody_disbursements SELECT policy
--    Anyone with treasury access can view (page is already gated).
-- ============================================================
DROP POLICY IF EXISTS "Owner custody disbursements: viewable by treasury or admin" ON public.owner_custody_disbursements;

CREATE POLICY "Owner custody disbursements: select"
  ON public.owner_custody_disbursements
  FOR SELECT TO authenticated
  USING (true);   -- page-level protection is sufficient; row-level not needed here

-- ============================================================
-- 3. Grant explicit SELECT on the table to authenticated
-- ============================================================
GRANT SELECT ON public.owner_custody_disbursements TO authenticated;
GRANT INSERT ON public.owner_custody_disbursements TO authenticated;

-- ============================================================
-- FILE: 0022_patch_expense_admin_insert.sql
-- ============================================================
-- 0022_patch_expense_admin_insert.sql
-- Allow super admins to insert expenses on behalf of any employee
-- (previously only allowed self-insert with has_custody_access)

DROP POLICY IF EXISTS "Expenses insertable" ON public.expenses;

CREATE POLICY "Expenses insertable"
  ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    -- (1) Employee submitting their own expense (must have custody access)
    (
      employee_id IS NOT NULL
      AND employee_id = public.current_employee_id()
      AND (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
    )
    OR
    -- (2) Super admin submitting on behalf of ANY employee
    (
      employee_id IS NOT NULL
      AND owner_id IS NULL
      AND public.is_super_admin()
    )
    OR
    -- (3) Admin/approver creating an expense on behalf of an owner
    (
      owner_id IS NOT NULL
      AND employee_id IS NULL
      AND (
        (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
        OR public.is_super_admin()
      )
    )
  );

-- ============================================================
-- FILE: 0023_fix_project_financial_expenses.sql
-- ============================================================
-- 0023_fix_project_financial_expenses.sql
-- Add approved employee (and owner) expenses to v_project_financial_position.
-- Previously total_expenses only included vendor claims + invoices,
-- so approved employee expenses had no effect on the project balance.

DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(CASE WHEN claim_type = 'owner'  THEN total_due_this_claim    ELSE 0 END) AS owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim    ELSE 0 END) AS vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) AS vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) AS invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
-- â–؛ NEW: employee + owner expenses approved against a project
expenses_agg AS (
    SELECT project_id, SUM(amount) AS total_employee_expenses
    FROM public.expenses
    WHERE status = 'approved'
      AND project_id IS NOT NULL
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) AS retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) AS total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
    UNION ALL
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
    UNION ALL
    SELECT r.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
),
vendor_cash AS (
    SELECT project_id, SUM(amount) AS total_paid
    FROM vendor_allocations
    GROUP BY project_id
)
SELECT
    p.id   AS project_id,
    p.name,
    p.code,
    COALESCE(pca.owner_billed, 0)                                                               AS total_income,
    COALESCE(oc.total_received, 0)                                                              AS total_received,
    -- â–؛ total_expenses now includes vendor claims + invoices + employee/owner expenses
    COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)                                                 AS total_expenses,
    COALESCE(vc.total_paid, 0)                                                                  AS total_paid,
    COALESCE(pca.vendor_retained, 0) - COALESCE(rra.retention_released, 0)                     AS retention_held,
    -- â–؛ balance also deducts employee/owner expenses
    COALESCE(pca.owner_billed, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)                                                 AS balance
FROM public.projects p
LEFT JOIN proj_claims_agg       pca ON pca.project_id = p.id
LEFT JOIN invoices_agg           ia ON ia.project_id  = p.id
LEFT JOIN expenses_agg           ea ON ea.project_id  = p.id
LEFT JOIN retention_releases_agg rra ON rra.project_id = p.id
LEFT JOIN owner_cash             oc ON oc.project_id  = p.id
LEFT JOIN vendor_cash            vc ON vc.project_id  = p.id;

-- ============================================================
-- FILE: 0024_fix_v_claim_totals.sql
-- ============================================================
-- Fix v_claim_totals: total_due_this_claim should be
-- cumulative_payable - actual_cash_paid (from ledger), not prior_claim_cumulative.
-- This matches the agreed cumulative logic: claim N is the truth;
-- what you owe = its cumulative net âˆ’ what you've already received.

CREATE OR REPLACE VIEW public.v_claim_totals AS
WITH item_math AS (
  SELECT
    ci.claim_id,
    (ci.previous_qty + ci.current_qty) * ci.unit_price                         AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct   AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct) AS cumulative_retained
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT
    claim_id,
    SUM(cumulative_line_total)  AS claim_cumulative_total,
    SUM(cumulative_payable)     AS claim_cumulative_payable,
    SUM(cumulative_retained)    AS claim_cumulative_retained
  FROM item_math
  GROUP BY claim_id
),
-- Sum of all actual payments recorded in the ledger for every claim
-- belonging to the same party + project + claim_type
actual_paid_per_party_project AS (
  SELECT
    c.party_id,
    c.project_id,
    c.claim_type,
    COALESCE(SUM(vcp.paid_amount), 0) AS total_actually_paid
  FROM public.claims c
  LEFT JOIN public.v_claim_paid vcp ON vcp.claim_id = c.id
  GROUP BY c.party_id, c.project_id, c.claim_type
)
SELECT
  c.id                                            AS claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  ap.total_actually_paid                          AS prior_cumulative_payable,
  -- Net payable before tax = cumulative payable âˆ’ all cash received so far
  GREATEST(cs.claim_cumulative_payable - ap.total_actually_paid, 0) AS net_payable_before_tax,
  -- Tax on the net amount
  CASE WHEN c.tax_enabled
    THEN GREATEST(cs.claim_cumulative_payable - ap.total_actually_paid, 0) * c.tax_rate
    ELSE 0
  END AS tax_amount,
  -- Total certificate amount
  GREATEST(cs.claim_cumulative_payable - ap.total_actually_paid, 0)
  + CASE WHEN c.tax_enabled
      THEN GREATEST(cs.claim_cumulative_payable - ap.total_actually_paid, 0) * c.tax_rate
      ELSE 0
    END AS total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs ON cs.claim_id = c.id
LEFT JOIN actual_paid_per_party_project ap
       ON ap.party_id = c.party_id
      AND ap.project_id = c.project_id
      AND ap.claim_type = c.claim_type;

-- ============================================================
-- FILE: 0025_opening_balances.sql
-- ============================================================
-- 0025_opening_balances.sql
-- Opening Balance / Project Migration Feature
-- Allows recording prior financial history when onboarding an ongoing project.

-- ============================================================================
-- 1. NEW TABLES
-- ============================================================================

-- 1a. project_opening_balances
--     One row per project. Stores lump-sum prior financial figures.
CREATE TABLE public.project_opening_balances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cutoff_date         date NOT NULL,
  prior_expenses      numeric(18,2) NOT NULL DEFAULT 0
                        CHECK (prior_expenses >= 0),
  prior_owner_income  numeric(18,2) NOT NULL DEFAULT 0
                        CHECK (prior_owner_income >= 0),
  notes               text,
  created_by          uuid REFERENCES public.employees(id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (project_id)
);

-- 1b. vendor_prior_claims
--     One row per project+vendor. Acts as "Claim #0" baseline for v_claim_totals.
CREATE TABLE public.vendor_prior_claims (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  vendor_id               uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  cutoff_date             date NOT NULL,
  prior_certified_amount  numeric(18,2) NOT NULL DEFAULT 0
                            CHECK (prior_certified_amount >= 0),
  prior_paid_amount       numeric(18,2) NOT NULL DEFAULT 0
                            CHECK (prior_paid_amount >= 0),
  prior_retention_held    numeric(18,2) NOT NULL DEFAULT 0
                            CHECK (prior_retention_held >= 0),
  -- outstanding = certified - paid - retention (computed in view, not stored)
  notes                   text,
  created_by              uuid REFERENCES public.employees(id),
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  UNIQUE (project_id, vendor_id),
  CONSTRAINT chk_vpc_paid_within_certified
    CHECK (prior_paid_amount + prior_retention_held <= prior_certified_amount)
);

-- 1c. opening_stock_entries
--     One row per project+warehouse+item. Seeds physical inventory at go-live.
CREATE TABLE public.opening_stock_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  warehouse_id  uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  qty           numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_price    numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  cutoff_date   date NOT NULL,
  notes         text,
  created_by    uuid REFERENCES public.employees(id),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (project_id, warehouse_id, item_id)
);

-- ============================================================================
-- 2. EXTEND stock_movements movement_type
-- ============================================================================

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
    CHECK (movement_type IN (
      'in_invoice', 'transfer_out', 'transfer_in', 'issue', 'adjust', 'opening_balance'
    ));

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX idx_project_opening_balances_project ON public.project_opening_balances(project_id);
CREATE INDEX idx_vendor_prior_claims_project      ON public.vendor_prior_claims(project_id);
CREATE INDEX idx_vendor_prior_claims_vendor       ON public.vendor_prior_claims(vendor_id);
CREATE INDEX idx_opening_stock_entries_project    ON public.opening_stock_entries(project_id);
CREATE INDEX idx_opening_stock_entries_wh_item    ON public.opening_stock_entries(warehouse_id, item_id);

-- ============================================================================
-- 4. UPDATED TRIGGERS
-- ============================================================================

CREATE TRIGGER trg_set_updated_at_proj_opening
  BEFORE UPDATE ON public.project_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_set_updated_at_vendor_prior
  BEFORE UPDATE ON public.vendor_prior_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS
-- ============================================================================

ALTER TABLE public.project_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_prior_claims       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_stock_entries     ENABLE ROW LEVEL SECURITY;

-- project_opening_balances
CREATE POLICY "Opening balance select scoped" ON public.project_opening_balances
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Opening balance write super admin only" ON public.project_opening_balances
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- vendor_prior_claims
CREATE POLICY "Vendor prior claims select scoped" ON public.vendor_prior_claims
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Vendor prior claims write super admin only" ON public.vendor_prior_claims
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- opening_stock_entries
CREATE POLICY "Opening stock select scoped" ON public.opening_stock_entries
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Opening stock write super admin only" ON public.opening_stock_entries
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ============================================================================
-- 6. REBUILD v_claim_totals â€” Option B flat offset for vendor_prior_claims
-- ============================================================================

DROP VIEW IF EXISTS public.v_claim_totals CASCADE;

CREATE OR REPLACE VIEW public.v_claim_totals WITH (security_invoker = true) AS
WITH item_math AS (
  SELECT
    ci.claim_id,
    ci.item_ref,
    ci.previous_qty,
    ci.current_qty,
    ci.unit_price,
    ci.disbursement_pct,
    (ci.previous_qty + ci.current_qty) * ci.unit_price                              AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct        AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct)  AS cumulative_retained
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT
    claim_id,
    SUM(cumulative_line_total)  AS claim_cumulative_total,
    SUM(cumulative_payable)     AS claim_cumulative_payable,
    SUM(cumulative_retained)    AS claim_cumulative_retained
  FROM item_math
  GROUP BY claim_id
),
-- Prior cumulative payable from previous IN-SYSTEM approved claims
in_system_prior AS (
  SELECT
    c.id AS claim_id,
    COALESCE(
      (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
       FROM public.claims pc
       JOIN public.claim_items pci ON pci.claim_id = pc.id
       WHERE pc.project_id = c.project_id
         AND pc.party_id   = c.party_id
         AND pc.claim_number < c.claim_number
         AND pc.status = 'approved'
         AND pc.claim_type = c.claim_type
      ), 0
    ) AS in_system_prior_payable
  FROM public.claims c
)
SELECT
  c.id          AS claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  -- â–؛ Option B: prior_cumulative_payable = in-system prior + flat Claim #0 offset
  isp.in_system_prior_payable
    + COALESCE(vpc.prior_certified_amount, 0)                                        AS prior_cumulative_payable,
  -- net_payable_before_tax = cumulative_payable âˆ’ total prior
  (cs.claim_cumulative_payable
    - isp.in_system_prior_payable
    - COALESCE(vpc.prior_certified_amount, 0))                                       AS net_payable_before_tax,
  -- tax
  CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable
      - isp.in_system_prior_payable
      - COALESCE(vpc.prior_certified_amount, 0)) * c.tax_rate
  ELSE 0 END                                                                         AS tax_amount,
  -- total_due_this_claim (with tax)
  (cs.claim_cumulative_payable
    - isp.in_system_prior_payable
    - COALESCE(vpc.prior_certified_amount, 0))
  + CASE WHEN c.tax_enabled THEN
      (cs.claim_cumulative_payable
        - isp.in_system_prior_payable
        - COALESCE(vpc.prior_certified_amount, 0)) * c.tax_rate
    ELSE 0 END                                                                       AS total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs       ON cs.claim_id    = c.id
LEFT JOIN in_system_prior isp ON isp.claim_id   = c.id
-- Only join vendor_prior_claims for vendor claim type (not owner)
LEFT JOIN public.vendor_prior_claims vpc
       ON vpc.project_id = c.project_id
      AND vpc.vendor_id  = c.party_id
      AND c.claim_type   = 'vendor';

-- ============================================================================
-- 7. REBUILD v_project_financial_position â€” include opening balance figures
-- ============================================================================

DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(CASE WHEN claim_type = 'owner'  THEN total_due_this_claim     ELSE 0 END) AS owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim     ELSE 0 END) AS vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) AS vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) AS invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
expenses_agg AS (
    SELECT project_id, SUM(amount) AS total_employee_expenses
    FROM public.expenses
    WHERE status = 'approved'
      AND project_id IS NOT NULL
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) AS retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) AS total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
    UNION ALL
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
    UNION ALL
    SELECT r.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
),
vendor_cash AS (
    SELECT project_id, SUM(amount) AS total_paid
    FROM vendor_allocations
    GROUP BY project_id
),
-- â–؛ Opening balance prior vendor claims total (sum per project, informational)
prior_vendor_claims_agg AS (
    SELECT
        project_id,
        SUM(prior_certified_amount) AS total_prior_certified,
        SUM(prior_paid_amount)      AS total_prior_paid,
        SUM(prior_retention_held)   AS total_prior_retention,
        COUNT(*)                    AS vendor_count
    FROM public.vendor_prior_claims
    GROUP BY project_id
),
-- â–؛ Opening inventory asset value using average cost
-- avg_cost per item per project = total value in / total qty in for all +ve movements
inventory_receipts AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END)               AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END) AS total_value_in
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
),
inventory_avg_cost AS (
    SELECT
        ir.project_id,
        ir.item_id,
        CASE WHEN ir.total_qty_in > 0
             THEN ir.total_value_in / ir.total_qty_in
             ELSE 0
        END AS avg_cost
    FROM inventory_receipts ir
),
inventory_on_hand AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(sm.qty) AS qty_on_hand
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
    HAVING SUM(sm.qty) > 0
),
inventory_asset AS (
    SELECT
        ioh.project_id,
        SUM(ioh.qty_on_hand * iac.avg_cost) AS total_asset_value
    FROM inventory_on_hand ioh
    JOIN inventory_avg_cost iac
      ON iac.project_id = ioh.project_id
     AND iac.item_id    = ioh.item_id
    GROUP BY ioh.project_id
)
SELECT
    p.id   AS project_id,
    p.name,
    p.code,

    -- â–؛ Opening balance metadata
    CASE WHEN ob.id IS NOT NULL THEN true ELSE false END  AS has_opening_balance,
    ob.cutoff_date                                         AS opening_cutoff_date,
    COALESCE(ob.prior_expenses,     0)                     AS prior_expenses,
    COALESCE(ob.prior_owner_income, 0)                     AS prior_owner_income,

    -- â–؛ Vendor prior claims summary (informational)
    COALESCE(pvca.total_prior_certified,  0)               AS prior_vendor_certified,
    COALESCE(pvca.total_prior_paid,       0)               AS prior_vendor_paid,
    COALESCE(pvca.total_prior_retention,  0)               AS prior_vendor_retention,
    COALESCE(pvca.vendor_count,           0)               AS prior_vendor_count,

    -- â–؛ In-system figures
    COALESCE(pca.owner_billed,  0)                         AS in_system_income,
    COALESCE(oc.total_received, 0)                         AS total_received,
    COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS in_system_expenses,
    COALESCE(vc.total_paid, 0)                             AS total_paid,
    COALESCE(pca.vendor_retained, 0)
      - COALESCE(rra.retention_released, 0)               AS retention_held,

    -- â–؛ Inventory asset (items still in warehouse, avg cost)
    COALESCE(ia_asset.total_asset_value, 0)                AS inventory_asset_value,

    -- â–؛ Grand totals
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)                      AS total_income,

    COALESCE(ob.prior_expenses, 0)
      + COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS total_expenses,

    -- balance = total_income âˆ’ total_expenses
    -- (inventory_asset_value is shown separately as an asset, not deducted here)
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS balance

FROM public.projects p
LEFT JOIN public.project_opening_balances ob  ON ob.project_id  = p.id
LEFT JOIN proj_claims_agg                 pca ON pca.project_id = p.id
LEFT JOIN invoices_agg                    ia  ON ia.project_id  = p.id
LEFT JOIN expenses_agg                    ea  ON ea.project_id  = p.id
LEFT JOIN retention_releases_agg          rra ON rra.project_id = p.id
LEFT JOIN owner_cash                      oc  ON oc.project_id  = p.id
LEFT JOIN vendor_cash                     vc  ON vc.project_id  = p.id
LEFT JOIN prior_vendor_claims_agg         pvca ON pvca.project_id = p.id
LEFT JOIN inventory_asset                 ia_asset ON ia_asset.project_id = p.id;

-- ============================================================================
-- 8. RPCs
-- ============================================================================

-- 8a. upsert_project_opening_balance
CREATE OR REPLACE FUNCTION public.upsert_project_opening_balance(
    p_project_id         uuid,
    p_cutoff_date        date,
    p_prior_expenses     numeric,
    p_prior_owner_income numeric,
    p_notes              text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_emp_id  uuid;
    v_node    text;
    v_id      uuid;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can set opening balances';
    END IF;

    -- Prevent setting opening balance on main_company
    SELECT node_type INTO v_node FROM public.projects WHERE id = p_project_id;
    IF v_node = 'main_company' THEN
        RAISE EXCEPTION 'Cannot set opening balance on the main company node';
    END IF;

    IF p_prior_expenses < 0 OR p_prior_owner_income < 0 THEN
        RAISE EXCEPTION 'Opening balance amounts cannot be negative';
    END IF;

    v_emp_id := public.current_employee_id();

    INSERT INTO public.project_opening_balances
        (project_id, cutoff_date, prior_expenses, prior_owner_income, notes, created_by)
    VALUES
        (p_project_id, p_cutoff_date, p_prior_expenses, p_prior_owner_income, p_notes, v_emp_id)
    ON CONFLICT (project_id) DO UPDATE SET
        cutoff_date        = EXCLUDED.cutoff_date,
        prior_expenses     = EXCLUDED.prior_expenses,
        prior_owner_income = EXCLUDED.prior_owner_income,
        notes              = EXCLUDED.notes,
        updated_at         = now()
    RETURNING id INTO v_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'project_opening_balance', p_project_id,
            jsonb_build_object(
                'cutoff_date', p_cutoff_date,
                'prior_expenses', p_prior_expenses,
                'prior_owner_income', p_prior_owner_income
            ));

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8b. upsert_vendor_prior_claim
CREATE OR REPLACE FUNCTION public.upsert_vendor_prior_claim(
    p_project_id             uuid,
    p_vendor_id              uuid,
    p_cutoff_date            date,
    p_prior_certified_amount numeric,
    p_prior_paid_amount      numeric,
    p_prior_retention_held   numeric,
    p_notes                  text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_emp_id uuid;
    v_id     uuid;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can set vendor prior claims';
    END IF;

    IF p_prior_certified_amount < 0 OR p_prior_paid_amount < 0 OR p_prior_retention_held < 0 THEN
        RAISE EXCEPTION 'Prior claim amounts cannot be negative';
    END IF;

    IF p_prior_paid_amount + p_prior_retention_held > p_prior_certified_amount THEN
        RAISE EXCEPTION 'Paid + Retention cannot exceed Certified amount';
    END IF;

    v_emp_id := public.current_employee_id();

    INSERT INTO public.vendor_prior_claims
        (project_id, vendor_id, cutoff_date, prior_certified_amount,
         prior_paid_amount, prior_retention_held, notes, created_by)
    VALUES
        (p_project_id, p_vendor_id, p_cutoff_date, p_prior_certified_amount,
         p_prior_paid_amount, p_prior_retention_held, p_notes, v_emp_id)
    ON CONFLICT (project_id, vendor_id) DO UPDATE SET
        cutoff_date             = EXCLUDED.cutoff_date,
        prior_certified_amount  = EXCLUDED.prior_certified_amount,
        prior_paid_amount       = EXCLUDED.prior_paid_amount,
        prior_retention_held    = EXCLUDED.prior_retention_held,
        notes                   = EXCLUDED.notes,
        updated_at              = now()
    RETURNING id INTO v_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'vendor_prior_claim', p_project_id,
            jsonb_build_object(
                'vendor_id', p_vendor_id,
                'prior_certified_amount', p_prior_certified_amount,
                'prior_paid_amount', p_prior_paid_amount,
                'prior_retention_held', p_prior_retention_held
            ));

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8c. delete_vendor_prior_claim
CREATE OR REPLACE FUNCTION public.delete_vendor_prior_claim(
    p_id uuid
) RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_row    public.vendor_prior_claims;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can delete vendor prior claims';
    END IF;

    SELECT * INTO v_row FROM public.vendor_prior_claims WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Vendor prior claim not found';
    END IF;

    v_emp_id := public.current_employee_id();

    DELETE FROM public.vendor_prior_claims WHERE id = p_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before)
    VALUES (v_emp_id, 'delete', 'vendor_prior_claim', p_id,
            to_jsonb(v_row));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8d. upsert_opening_stock_entry
--     Creates/updates the opening_stock_entries row AND its stock_movements row.
CREATE OR REPLACE FUNCTION public.upsert_opening_stock_entry(
    p_project_id   uuid,
    p_warehouse_id uuid,
    p_item_id      uuid,
    p_qty          numeric,
    p_unit_price   numeric,
    p_cutoff_date  date,
    p_notes        text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_emp_id      uuid;
    v_entry_id    uuid;
    v_old_mov_id  uuid;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can set opening stock entries';
    END IF;

    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'Opening stock quantity must be positive';
    END IF;
    IF p_unit_price < 0 THEN
        RAISE EXCEPTION 'Unit price cannot be negative';
    END IF;

    v_emp_id := public.current_employee_id();

    -- Find the old stock movement reference (if entry exists)
    SELECT sm.id INTO v_old_mov_id
    FROM public.opening_stock_entries ose
    JOIN public.stock_movements sm
      ON sm.warehouse_id   = ose.warehouse_id
     AND sm.item_id        = ose.item_id
     AND sm.movement_type  = 'opening_balance'
     AND sm.reference_id   = ose.id
    WHERE ose.project_id   = p_project_id
      AND ose.warehouse_id = p_warehouse_id
      AND ose.item_id      = p_item_id
    LIMIT 1;

    -- Upsert the opening stock entry
    INSERT INTO public.opening_stock_entries
        (project_id, warehouse_id, item_id, qty, unit_price, cutoff_date, notes, created_by)
    VALUES
        (p_project_id, p_warehouse_id, p_item_id, p_qty, p_unit_price, p_cutoff_date, p_notes, v_emp_id)
    ON CONFLICT (project_id, warehouse_id, item_id) DO UPDATE SET
        qty          = EXCLUDED.qty,
        unit_price   = EXCLUDED.unit_price,
        cutoff_date  = EXCLUDED.cutoff_date,
        notes        = EXCLUDED.notes
    RETURNING id INTO v_entry_id;

    -- Remove old stock movement if exists
    IF v_old_mov_id IS NOT NULL THEN
        DELETE FROM public.stock_movements WHERE id = v_old_mov_id;
    END IF;

    -- Insert fresh stock movement
    INSERT INTO public.stock_movements
        (warehouse_id, item_id, movement_type, qty, unit_price, reference_id, notes, created_by)
    VALUES
        (p_warehouse_id, p_item_id, 'opening_balance', p_qty, p_unit_price,
         v_entry_id, COALESCE(p_notes, 'Opening balance stock entry'), v_emp_id);

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'opening_stock_entry', v_entry_id,
            jsonb_build_object(
                'warehouse_id', p_warehouse_id,
                'item_id', p_item_id,
                'qty', p_qty,
                'unit_price', p_unit_price
            ));

    RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8e. delete_opening_stock_entry
CREATE OR REPLACE FUNCTION public.delete_opening_stock_entry(
    p_entry_id uuid
) RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_entry  public.opening_stock_entries;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can delete opening stock entries';
    END IF;

    SELECT * INTO v_entry FROM public.opening_stock_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Opening stock entry not found';
    END IF;

    v_emp_id := public.current_employee_id();

    -- Delete corresponding stock movement
    DELETE FROM public.stock_movements
    WHERE movement_type = 'opening_balance'
      AND reference_id  = p_entry_id;

    DELETE FROM public.opening_stock_entries WHERE id = p_entry_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before)
    VALUES (v_emp_id, 'delete', 'opening_stock_entry', p_entry_id, to_jsonb(v_entry));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FILE: 0026_fix_v_claim_totals_with_prior.sql
-- ============================================================
-- 0026_fix_v_claim_totals_with_prior.sql
-- Fix v_claim_totals after 0025 introduced vendor_prior_claims.
-- Strategy: keep 0024's approach (actual cash paid from ledger as the deduction)
-- but ALSO add prior_certified_amount from vendor_prior_claims as an additional
-- historical offset in prior_cumulative_payable.
-- Result for Claim #1 of vendor with prior history:
--   net_payable_before_tax = cumulative_payable - prior_certified_amount - total_actually_paid
-- This ensures the first in-system claim only bills the delta over pre-existing work.

DROP VIEW IF EXISTS public.v_claim_totals CASCADE;

CREATE OR REPLACE VIEW public.v_claim_totals WITH (security_invoker = true) AS
WITH item_math AS (
  SELECT
    ci.claim_id,
    (ci.previous_qty + ci.current_qty) * ci.unit_price                         AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct   AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct) AS cumulative_retained
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT
    claim_id,
    SUM(cumulative_line_total)  AS claim_cumulative_total,
    SUM(cumulative_payable)     AS claim_cumulative_payable,
    SUM(cumulative_retained)    AS claim_cumulative_retained
  FROM item_math
  GROUP BY claim_id
),
-- Sum of all actual payments recorded in the ledger for this party+project+type
actual_paid_per_party_project AS (
  SELECT
    c.party_id,
    c.project_id,
    c.claim_type,
    COALESCE(SUM(vcp.paid_amount), 0) AS total_actually_paid
  FROM public.claims c
  LEFT JOIN public.v_claim_paid vcp ON vcp.claim_id = c.id
  GROUP BY c.party_id, c.project_id, c.claim_type
)
SELECT
  c.id                                               AS claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  -- prior_cumulative_payable = historical certified (Claim #0) + actual ledger payments
  ap.total_actually_paid
    + COALESCE(vpc.prior_certified_amount, 0)        AS prior_cumulative_payable,
  -- Net payable before tax = cumulative payable âˆ’ all prior certified âˆ’ all cash received
  GREATEST(
    cs.claim_cumulative_payable
      - COALESCE(vpc.prior_certified_amount, 0)
      - ap.total_actually_paid,
    0
  )                                                  AS net_payable_before_tax,
  -- Tax
  CASE WHEN c.tax_enabled
    THEN GREATEST(
      cs.claim_cumulative_payable
        - COALESCE(vpc.prior_certified_amount, 0)
        - ap.total_actually_paid,
      0
    ) * c.tax_rate
    ELSE 0
  END                                                AS tax_amount,
  -- Total certificate amount
  GREATEST(
    cs.claim_cumulative_payable
      - COALESCE(vpc.prior_certified_amount, 0)
      - ap.total_actually_paid,
    0
  )
  + CASE WHEN c.tax_enabled
      THEN GREATEST(
        cs.claim_cumulative_payable
          - COALESCE(vpc.prior_certified_amount, 0)
          - ap.total_actually_paid,
        0
      ) * c.tax_rate
      ELSE 0
    END                                              AS total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs ON cs.claim_id = c.id
LEFT JOIN actual_paid_per_party_project ap
       ON ap.party_id    = c.party_id
      AND ap.project_id  = c.project_id
      AND ap.claim_type  = c.claim_type
-- Only apply prior offset for vendor claims (owner claims have no prior)
LEFT JOIN public.vendor_prior_claims vpc
       ON vpc.project_id = c.project_id
      AND vpc.vendor_id  = c.party_id
      AND c.claim_type   = 'vendor';

-- Restore v_project_financial_position which was cascaded with v_claim_totals
-- (0025 already has the correct version, we just need to recreate it)
DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(CASE WHEN claim_type = 'owner'  THEN total_due_this_claim     ELSE 0 END) AS owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim     ELSE 0 END) AS vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) AS vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) AS invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
expenses_agg AS (
    SELECT project_id, SUM(amount) AS total_employee_expenses
    FROM public.expenses
    WHERE status = 'approved'
      AND project_id IS NOT NULL
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) AS retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) AS total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
    UNION ALL
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
    UNION ALL
    SELECT r.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
),
vendor_cash AS (
    SELECT project_id, SUM(amount) AS total_paid
    FROM vendor_allocations
    GROUP BY project_id
),
prior_vendor_claims_agg AS (
    SELECT
        project_id,
        SUM(prior_certified_amount) AS total_prior_certified,
        SUM(prior_paid_amount)      AS total_prior_paid,
        SUM(prior_retention_held)   AS total_prior_retention,
        COUNT(*)                    AS vendor_count
    FROM public.vendor_prior_claims
    GROUP BY project_id
),
inventory_receipts AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END)                                    AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END)       AS total_value_in
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
),
inventory_avg_cost AS (
    SELECT
        ir.project_id,
        ir.item_id,
        CASE WHEN ir.total_qty_in > 0
             THEN ir.total_value_in / ir.total_qty_in
             ELSE 0
        END AS avg_cost
    FROM inventory_receipts ir
),
inventory_on_hand AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(sm.qty) AS qty_on_hand
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
    HAVING SUM(sm.qty) > 0
),
inventory_asset AS (
    SELECT
        ioh.project_id,
        SUM(ioh.qty_on_hand * iac.avg_cost) AS total_asset_value
    FROM inventory_on_hand ioh
    JOIN inventory_avg_cost iac
      ON iac.project_id = ioh.project_id
     AND iac.item_id    = ioh.item_id
    GROUP BY ioh.project_id
)
SELECT
    p.id   AS project_id,
    p.name,
    p.code,
    p.node_type,

    -- â–؛ Opening balance metadata
    CASE WHEN ob.id IS NOT NULL THEN true ELSE false END  AS has_opening_balance,
    ob.cutoff_date                                         AS opening_cutoff_date,
    COALESCE(ob.prior_expenses,     0)                     AS prior_expenses,
    COALESCE(ob.prior_owner_income, 0)                     AS prior_owner_income,

    -- â–؛ Vendor prior claims summary (informational)
    COALESCE(pvca.total_prior_certified,  0)               AS prior_vendor_certified,
    COALESCE(pvca.total_prior_paid,       0)               AS prior_vendor_paid,
    COALESCE(pvca.total_prior_retention,  0)               AS prior_vendor_retention,
    COALESCE(pvca.vendor_count,           0)               AS prior_vendor_count,

    -- â–؛ In-system figures
    COALESCE(pca.owner_billed,  0)                         AS in_system_income,
    COALESCE(oc.total_received, 0)                         AS total_received,
    COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS in_system_expenses,
    COALESCE(vc.total_paid, 0)                             AS total_paid,
    COALESCE(pca.vendor_retained, 0)
      - COALESCE(rra.retention_released, 0)               AS retention_held,

    -- â–؛ Inventory asset (items still in warehouse, avg cost)
    COALESCE(ia_asset.total_asset_value, 0)                AS inventory_asset_value,

    -- â–؛ Grand totals (prior + in-system)
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)                      AS total_income,

    COALESCE(ob.prior_expenses, 0)
      + COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS total_expenses,

    -- balance = total_income âˆ’ total_expenses
    -- (inventory_asset_value is shown separately as an asset, not deducted)
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS balance,

    -- net_position (alias kept for homepage compatibility)
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS net_position

FROM public.projects p
LEFT JOIN public.project_opening_balances ob  ON ob.project_id  = p.id
LEFT JOIN proj_claims_agg                 pca ON pca.project_id = p.id
LEFT JOIN invoices_agg                    ia  ON ia.project_id  = p.id
LEFT JOIN expenses_agg                    ea  ON ea.project_id  = p.id
LEFT JOIN retention_releases_agg          rra ON rra.project_id = p.id
LEFT JOIN owner_cash                      oc  ON oc.project_id  = p.id
LEFT JOIN vendor_cash                     vc  ON vc.project_id  = p.id
LEFT JOIN prior_vendor_claims_agg         pvca ON pvca.project_id = p.id
LEFT JOIN inventory_asset                 ia_asset ON ia_asset.project_id = p.id;

-- ============================================================
-- FILE: 0027_treasury_project_links.sql
-- ============================================================
-- 0027_treasury_project_links.sql

-- Drop existing functions so we can recreate them with the new p_project_id parameter
DROP FUNCTION IF EXISTS public.record_vendor_payment(uuid, uuid, numeric, text, jsonb);
DROP FUNCTION IF EXISTS public.record_owner_receipt(uuid, uuid, numeric, text, jsonb);

CREATE OR REPLACE FUNCTION public.record_vendor_payment(
    p_bank_account_id uuid,
    p_vendor_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb, -- Array of { target_type, target_id, amount }
    p_project_id uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
BEGIN
    -- Authorization
    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    -- Validate allocations sum <= amount
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_total_allocated := v_total_allocated + (v_alloc->>'amount')::numeric;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed payment amount';
    END IF;

    -- Insert Ledger Entry with optional project_id
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, project_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'out', p_amount, 'vendor_payment', p_bank_account_id, 'vendor', p_vendor_id, p_project_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        IF (v_alloc->>'amount')::numeric > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_alloc->>'target_type', (v_alloc->>'target_id')::uuid, (v_alloc->>'amount')::numeric
            );
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'vendor_payment', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations, 'project_id', p_project_id));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.record_owner_receipt(
    p_bank_account_id uuid,
    p_owner_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb, -- Array of { target_type, target_id, amount }
    p_project_id uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
BEGIN
    -- Authorization
    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to record receipts';
    END IF;

    -- Validate allocations sum <= amount
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_total_allocated := v_total_allocated + (v_alloc->>'amount')::numeric;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed receipt amount';
    END IF;

    -- Insert Ledger Entry with optional project_id
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, project_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'in', p_amount, 'owner_payment', p_bank_account_id, 'owner', p_owner_id, p_project_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        IF (v_alloc->>'amount')::numeric > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_alloc->>'target_type', (v_alloc->>'target_id')::uuid, (v_alloc->>'amount')::numeric
            );

            IF v_alloc->>'target_type' = 'owner_schedule' THEN
                UPDATE public.owner_payment_schedule ops
                SET status = CASE 
                    WHEN (SELECT COALESCE(SUM(allocated_amount), 0) FROM public.payment_allocations WHERE target_id = ops.id AND target_type = 'owner_schedule') >= ops.expected_amount THEN 'paid'
                    ELSE 'partial'
                END
                WHERE id = (v_alloc->>'target_id')::uuid;
            END IF;
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'owner_receipt', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations, 'project_id', p_project_id));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FILE: 0028_fix_financial_position_advances.sql
-- ============================================================
-- 0028_fix_financial_position_advances.sql
-- Update v_project_financial_position to count unallocated advances assigned to a project

DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(CASE WHEN claim_type = 'owner'  THEN total_due_this_claim     ELSE 0 END) AS owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim     ELSE 0 END) AS vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) AS vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) AS invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
expenses_agg AS (
    SELECT project_id, SUM(amount) AS total_employee_expenses
    FROM public.expenses
    WHERE status = 'approved'
      AND project_id IS NOT NULL
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) AS retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
    UNION ALL
    -- Include unallocated advances tied directly to the project!
    SELECT project_id, SUM(unallocated_amount) AS amount FROM (
        SELECT le.project_id, 
               le.amount - COALESCE((SELECT SUM(allocated_amount) FROM public.payment_allocations WHERE ledger_entry_id = le.id), 0) AS unallocated_amount
        FROM public.ledger_entries le
        WHERE le.counterparty_type = 'owner' AND le.direction = 'in' AND le.project_id IS NOT NULL
    ) sub
    GROUP BY project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) AS total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
    UNION ALL
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
    UNION ALL
    SELECT r.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
    UNION ALL
    -- Include unallocated vendor advances tied directly to the project!
    SELECT project_id, SUM(unallocated_amount) AS amount FROM (
        SELECT le.project_id, 
               le.amount - COALESCE((SELECT SUM(allocated_amount) FROM public.payment_allocations WHERE ledger_entry_id = le.id), 0) AS unallocated_amount
        FROM public.ledger_entries le
        WHERE le.counterparty_type = 'vendor' AND le.direction = 'out' AND le.project_id IS NOT NULL
    ) sub
    GROUP BY project_id
),
vendor_cash AS (
    SELECT project_id, SUM(amount) AS total_paid
    FROM vendor_allocations
    GROUP BY project_id
),
prior_vendor_claims_agg AS (
    SELECT
        project_id,
        SUM(prior_certified_amount) AS total_prior_certified,
        SUM(prior_paid_amount)      AS total_prior_paid,
        SUM(prior_retention_held)   AS total_prior_retention,
        COUNT(*)                    AS vendor_count
    FROM public.vendor_prior_claims
    GROUP BY project_id
),
inventory_receipts AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END)                                    AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END)       AS total_value_in
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
),
inventory_avg_cost AS (
    SELECT
        ir.project_id,
        ir.item_id,
        CASE WHEN ir.total_qty_in > 0
             THEN ir.total_value_in / ir.total_qty_in
             ELSE 0
        END AS avg_cost
    FROM inventory_receipts ir
),
inventory_on_hand AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(sm.qty) AS qty_on_hand
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
    HAVING SUM(sm.qty) > 0
),
inventory_asset AS (
    SELECT
        ioh.project_id,
        SUM(ioh.qty_on_hand * iac.avg_cost) AS total_asset_value
    FROM inventory_on_hand ioh
    JOIN inventory_avg_cost iac
      ON iac.project_id = ioh.project_id
     AND iac.item_id    = ioh.item_id
    GROUP BY ioh.project_id
)
SELECT
    p.id   AS project_id,
    p.name,
    p.code,
    p.node_type,

    -- â–؛ Opening balance metadata
    CASE WHEN ob.id IS NOT NULL THEN true ELSE false END  AS has_opening_balance,
    ob.cutoff_date                                         AS opening_cutoff_date,
    COALESCE(ob.prior_expenses,     0)                     AS prior_expenses,
    COALESCE(ob.prior_owner_income, 0)                     AS prior_owner_income,

    -- â–؛ Vendor prior claims summary (informational)
    COALESCE(pvca.total_prior_certified,  0)               AS prior_vendor_certified,
    COALESCE(pvca.total_prior_paid,       0)               AS prior_vendor_paid,
    COALESCE(pvca.total_prior_retention,  0)               AS prior_vendor_retention,
    COALESCE(pvca.vendor_count,           0)               AS prior_vendor_count,

    -- â–؛ In-system figures
    COALESCE(pca.owner_billed,  0)                         AS in_system_income,
    COALESCE(oc.total_received, 0)                         AS total_received,
    COALESCE(pca.vendor_billed, 0)                         AS in_system_vendor_certified,
    COALESCE(vc.total_paid,     0)                         AS total_paid,
    COALESCE(pca.vendor_retained, 0) - COALESCE(rra.retention_released, 0) AS retention_held,
    COALESCE(ia.invoice_total,  0)                         AS in_system_invoice_total,
    COALESCE(ea.total_employee_expenses, 0)                AS in_system_employee_expenses,

    -- â–؛ Derived Totals
    COALESCE(ob.prior_owner_income, 0) + COALESCE(pca.owner_billed, 0) AS total_income,
    
    COALESCE(ob.prior_expenses, 0) + COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) + COALESCE(ea.total_employee_expenses, 0) AS total_expenses,

    COALESCE(ia_asset.total_asset_value, 0)                AS inventory_asset_value,

    -- â–؛ Balance = Total Income - Total Expenses
    (COALESCE(ob.prior_owner_income, 0) + COALESCE(pca.owner_billed, 0)) - 
    (COALESCE(ob.prior_expenses, 0) + COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) + COALESCE(ea.total_employee_expenses, 0)) AS balance,

    (COALESCE(ob.prior_owner_income, 0) + COALESCE(pca.owner_billed, 0)) - 
    (COALESCE(ob.prior_expenses, 0) + COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) + COALESCE(ea.total_employee_expenses, 0)) AS net_position

FROM public.projects p
LEFT JOIN public.project_opening_balances ob ON ob.project_id = p.id
LEFT JOIN proj_claims_agg pca ON pca.project_id = p.id
LEFT JOIN invoices_agg ia ON ia.project_id = p.id
LEFT JOIN expenses_agg ea ON ea.project_id = p.id
LEFT JOIN owner_cash oc ON oc.project_id = p.id
LEFT JOIN vendor_cash vc ON vc.project_id = p.id
LEFT JOIN retention_releases_agg rra ON rra.project_id = p.id
LEFT JOIN prior_vendor_claims_agg pvca ON pvca.project_id = p.id
LEFT JOIN inventory_asset ia_asset ON ia_asset.project_id = p.id;

-- ============================================================
-- FILE: 0029_recreate_owner_vendor_account_views.sql
-- ============================================================
-- 0029_recreate_owner_vendor_account_views.sql
-- 
-- Migration 0026 used DROP VIEW ... CASCADE on v_claim_totals which silently
-- dropped v_owner_account, v_vendor_account, v_owner_balances, v_vendor_balances
-- (all depended on v_claim_totals via correlated subqueries).
-- This migration recreates all four views.

-- â”€â”€â”€ 1. v_owner_account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Shows per-document rows for an owner: approved claims (what is owed)
-- and ledger receipts (what has been collected).
-- amount_due  = total_due_this_claim from v_claim_totals (already net of allocations)
-- amount_paid = 0 on claim rows; receipt amount on receipt rows
-- running_balance = cumulative net (amount_due - amount_paid)

CREATE OR REPLACE VIEW public.v_owner_account WITH (security_invoker = true) AS
WITH owner_docs AS (

    -- â–؛ Approved owner claims (what the owner owes us)
    SELECT
        c.party_id,
        c.project_id,
        c.claim_date                                                                AS document_date,
        'claim'                                                                     AS document_type,
        c.id                                                                        AS document_id,
        ('ظ…ط³طھط®ظ„طµ ظ…ط§ظ„ظƒ ط±ظ‚ظ… ' || c.claim_number::text)                               AS description,
        COALESCE(
            (SELECT vct.total_due_this_claim
               FROM public.v_claim_totals vct
              WHERE vct.claim_id = c.id),
            0
        )                                                                           AS amount_due,
        0::numeric                                                                  AS amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved'
      AND c.claim_type = 'owner'

    UNION ALL

    -- â–؛ Ledger receipts (payments collected from the owner)
    SELECT
        le.counterparty_id                                                          AS party_id,
        le.project_id,
        le.entry_date                                                               AS document_date,
        'receipt'                                                                   AS document_type,
        le.id                                                                       AS document_id,
        COALESCE(le.memo, 'طھط­طµظٹظ„ ط¯ظپط¹ط©')                                            AS description,
        0::numeric                                                                  AS amount_due,
        le.amount                                                                   AS amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'owner'
      AND le.direction          = 'in'
)
SELECT
    d.party_id,
    d.project_id,
    p.name                                                                          AS project_name,
    d.document_date,
    d.document_type,
    d.document_id,
    d.description,
    d.amount_due,
    d.amount_paid,
    d.created_at,
    SUM(d.amount_due - d.amount_paid) OVER (
        PARTITION BY d.party_id
        ORDER BY d.document_date ASC, d.created_at ASC
    )                                                                               AS running_balance
FROM owner_docs d
LEFT JOIN public.projects p ON p.id = d.project_id;


-- â”€â”€â”€ 2. v_vendor_account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Same structure for the vendor side: invoices + vendor claims + retention
-- releases (what we owe vendors) and outgoing ledger payments.

CREATE OR REPLACE VIEW public.v_vendor_account WITH (security_invoker = true) AS
WITH vendor_docs AS (

    -- â–؛ Approved invoices
    SELECT
        i.vendor_id                                                                 AS party_id,
        i.project_id,
        i.invoice_date                                                              AS document_date,
        'invoice'                                                                   AS document_type,
        i.id                                                                        AS document_id,
        ('ظپط§طھظˆط±ط© #' || i.id::text)                                                  AS description,
        i.total                                                                     AS amount_due,
        COALESCE(
            (SELECT vip.paid_amount
               FROM public.v_invoice_paid vip
              WHERE vip.invoice_id = i.id),
            0
        )                                                                           AS amount_paid,
        i.created_at
    FROM public.invoices i
    WHERE i.status = 'approved'

    UNION ALL

    -- â–؛ Approved vendor claims
    SELECT
        c.party_id,
        c.project_id,
        c.claim_date                                                                AS document_date,
        'claim'                                                                     AS document_type,
        c.id                                                                        AS document_id,
        ('ظ…ط³طھط®ظ„طµ ظ…ظ‚ط§ظˆظ„ ط±ظ‚ظ… ' || c.claim_number::text)                              AS description,
        COALESCE(
            (SELECT vct.total_due_this_claim
               FROM public.v_claim_totals vct
              WHERE vct.claim_id = c.id),
            0
        )                                                                           AS amount_due,
        0::numeric                                                                  AS amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved'
      AND c.claim_type = 'vendor'

    UNION ALL

    -- â–؛ Retention releases
    SELECT
        r.party_id,
        r.project_id,
        r.released_at::date                                                         AS document_date,
        'retention_release'                                                         AS document_type,
        r.id                                                                        AS document_id,
        'ط¥ظپط±ط§ط¬ ط¶ظ…ط§ظ† ط­ط³ظ† طھظ†ظپظٹط°'                                                      AS description,
        r.amount                                                                    AS amount_due,
        COALESCE(
            (SELECT vrp.paid_amount
               FROM public.v_retention_paid vrp
              WHERE vrp.retention_id = r.id),
            0
        )                                                                           AS amount_paid,
        r.created_at
    FROM public.retention_releases r
    WHERE r.claim_type = 'vendor'

    UNION ALL

    -- â–؛ Outgoing ledger payments to vendors
    SELECT
        le.counterparty_id                                                          AS party_id,
        le.project_id,
        le.entry_date                                                               AS document_date,
        'payment'                                                                   AS document_type,
        le.id                                                                       AS document_id,
        COALESCE(le.memo, 'ط¯ظپط¹ط© ظ„ظ„ظ…ظ‚ط§ظˆظ„')                                           AS description,
        0::numeric                                                                  AS amount_due,
        le.amount                                                                   AS amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'vendor'
      AND le.direction          = 'out'
)
SELECT
    d.party_id,
    d.project_id,
    p.name                                                                          AS project_name,
    d.document_date,
    d.document_type,
    d.document_id,
    d.description,
    d.amount_due,
    d.amount_paid,
    d.created_at,
    SUM(d.amount_due - d.amount_paid) OVER (
        PARTITION BY d.party_id
        ORDER BY d.document_date ASC, d.created_at ASC
    )                                                                               AS running_balance
FROM vendor_docs d
LEFT JOIN public.projects p ON p.id = d.project_id;


-- â”€â”€â”€ 3. v_owner_balances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE VIEW public.v_owner_balances WITH (security_invoker = true) AS
SELECT
    o.id                                                                            AS owner_id,
    o.name                                                                          AS owner_name,
    COALESCE(SUM(oa.amount_due),  0)                                               AS total_due,
    COALESCE(SUM(oa.amount_paid), 0)                                               AS total_paid,
    COALESCE(SUM(oa.amount_due) - SUM(oa.amount_paid), 0)                         AS balance
FROM public.project_owners o
LEFT JOIN public.v_owner_account oa ON oa.party_id = o.id
GROUP BY o.id, o.name;


-- â”€â”€â”€ 4. v_vendor_balances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
SELECT
    v.id                                                                            AS vendor_id,
    v.name                                                                          AS vendor_name,
    COALESCE(SUM(va.amount_due),  0)                                               AS total_due,
    COALESCE(SUM(va.amount_paid), 0)                                               AS total_paid,
    COALESCE(SUM(va.amount_due) - SUM(va.amount_paid), 0)                         AS balance
FROM public.vendors v
LEFT JOIN public.v_vendor_account va ON va.party_id = v.id
GROUP BY v.id, v.name;

-- ============================================================
-- FILE: 0030_assign_owner_receipt.sql
-- ============================================================
-- 0030_assign_owner_receipt.sql
-- RPC to retroactively assign an unlinked owner receipt to a project
-- and optionally allocate it to an owner claim.
-- This patches an existing ledger_entry in-place (updates project_id, replaces allocations).

CREATE OR REPLACE FUNCTION public.assign_owner_receipt(
    p_ledger_entry_id uuid,
    p_project_id      uuid,
    p_allocations     jsonb  -- Array of { target_type, target_id, amount }
) RETURNS void AS $$
DECLARE
    v_entry          record;
    v_alloc          jsonb;
    v_alloc_amount   numeric;
    v_total_alloc    numeric := 0;
    v_target_id      uuid;
    v_target_type    text;
    v_doc_party_id   uuid;
    v_doc_project_id uuid;
BEGIN
    -- â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to assign receipts';
    END IF;

    -- â”€â”€ Load & validate the ledger entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    SELECT * INTO v_entry FROM public.ledger_entries WHERE id = p_ledger_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ledger entry not found: %', p_ledger_entry_id;
    END IF;
    IF v_entry.counterparty_type <> 'owner' OR v_entry.direction <> 'in' THEN
        RAISE EXCEPTION 'Can only assign owner receipt entries (direction=in, counterparty_type=owner)';
    END IF;

    -- Project access
    IF NOT public.is_super_admin() AND NOT public.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized to assign to project %', p_project_id;
    END IF;

    -- â”€â”€ Validate allocations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount <= 0 THEN CONTINUE; END IF;

        v_total_alloc  := v_total_alloc + v_alloc_amount;
        v_target_id    := (v_alloc->>'target_id')::uuid;
        v_target_type  := v_alloc->>'target_type';

        IF v_target_type = 'claim' THEN
            SELECT party_id, project_id
            INTO   v_doc_party_id, v_doc_project_id
            FROM   public.claims
            WHERE  id = v_target_id AND claim_type = 'owner';

            IF v_doc_party_id IS NULL THEN
                RAISE EXCEPTION 'Owner claim not found: %', v_target_id;
            END IF;
            IF v_doc_party_id <> v_entry.counterparty_id THEN
                RAISE EXCEPTION 'Claim % does not belong to owner %', v_target_id, v_entry.counterparty_id;
            END IF;
            IF v_doc_project_id <> p_project_id THEN
                RAISE EXCEPTION 'Claim % belongs to project % not %', v_target_id, v_doc_project_id, p_project_id;
            END IF;
        ELSIF v_target_type = 'owner_schedule' THEN
            -- owner_schedule validation (party via project â†’ owner)
            NULL; -- allow, owner_schedule is project-scoped
        ELSE
            RAISE EXCEPTION 'Unsupported allocation target_type for owner receipt: %', v_target_type;
        END IF;
    END LOOP;

    IF v_total_alloc > v_entry.amount THEN
        RAISE EXCEPTION 'Total allocations (%) exceed receipt amount (%)', v_total_alloc, v_entry.amount;
    END IF;

    -- â”€â”€ Apply changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    -- 1. Update project_id on the ledger entry
    UPDATE public.ledger_entries
    SET    project_id = p_project_id
    WHERE  id = p_ledger_entry_id;

    -- 2. Clear any existing allocations (clean-slate re-assignment)
    DELETE FROM public.payment_allocations WHERE ledger_entry_id = p_ledger_entry_id;

    -- 3. Insert new allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount > 0 THEN
            INSERT INTO public.payment_allocations (ledger_entry_id, target_type, target_id, allocated_amount)
            VALUES (
                p_ledger_entry_id,
                v_alloc->>'target_type',
                (v_alloc->>'target_id')::uuid,
                v_alloc_amount
            );
        END IF;
    END LOOP;

    -- 4. Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        public.current_employee_id(),
        'update',
        'owner_receipt',
        p_ledger_entry_id,
        jsonb_build_object(
            'project_id',  p_project_id,
            'allocations', p_allocations
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FILE: 0031_performance_indexes.sql
-- ============================================================
-- ============================================================
-- Migration 0031: Performance indexes + v_latest_owner_claims
-- ============================================================

-- â”€â”€ 1. payment_allocations: CRITICAL â€” joined in 4+ financial views with no index â”€â”€
CREATE INDEX IF NOT EXISTS idx_payment_alloc_target
  ON public.payment_allocations(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_payment_alloc_ledger
  ON public.payment_allocations(ledger_entry_id);

-- â”€â”€ 2. claims: status + claim_type â€” filtered on every single claims query â”€â”€
CREATE INDEX IF NOT EXISTS idx_claims_status
  ON public.claims(status);

CREATE INDEX IF NOT EXISTS idx_claims_claim_type
  ON public.claims(claim_type);

-- Composite: covers the v_claim_totals LATERAL subquery pattern
-- WHERE project_id = X AND party_id = Y AND claim_type = Z AND status = 'approved' AND claim_number < N
CREATE INDEX IF NOT EXISTS idx_claims_composite
  ON public.claims(project_id, party_id, claim_type, status, claim_number);

-- â”€â”€ 3. ledger_entries: category + direction â€” unindexed despite heavy filtering â”€â”€
CREATE INDEX IF NOT EXISTS idx_ledger_category
  ON public.ledger_entries(category);

CREATE INDEX IF NOT EXISTS idx_ledger_direction
  ON public.ledger_entries(direction);

-- Composite: most treasury queries filter on category + direction together + date sort
CREATE INDEX IF NOT EXISTS idx_ledger_category_direction_date
  ON public.ledger_entries(category, direction, entry_date DESC);

-- â”€â”€ 4. invoices: status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON public.invoices(status);

-- â”€â”€ 5. expenses: project_id (used in v_project_financial_position) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE INDEX IF NOT EXISTS idx_expenses_project_id
  ON public.expenses(project_id);

-- owner_id already created in migration 0020 â€” skip duplicate

-- â”€â”€ 6. owner_payment_schedule: project_id + status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE INDEX IF NOT EXISTS idx_owner_schedule_project
  ON public.owner_payment_schedule(project_id);

CREATE INDEX IF NOT EXISTS idx_owner_schedule_status
  ON public.owner_payment_schedule(status);

-- â”€â”€ 7. deposit_payouts: is_collected + due_date (home dashboard filter) â”€â”€â”€â”€â”€â”€
CREATE INDEX IF NOT EXISTS idx_deposit_payouts_collected_date
  ON public.deposit_payouts(is_collected, due_date);

-- â”€â”€ 8. v_latest_owner_claims: pre-compute latest approved claim per (owner, project) â”€â”€
-- Replaces the unbounded SELECT + JS DISTINCT ON in treasury/page.tsx
CREATE OR REPLACE VIEW public.v_latest_owner_claims AS
SELECT DISTINCT ON (party_id, project_id)
  id          AS claim_id,
  party_id,
  project_id,
  claim_number
FROM public.claims
WHERE claim_type = 'owner'
  AND status    = 'approved'
ORDER BY party_id, project_id, claim_number DESC;

-- ============================================================
-- FILE: 0032_project_financial_summary.sql
-- ============================================================
-- 0032_project_financial_summary.sql
-- Updates v_project_financial_position to separate paid/billed amounts for project cards UI

DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(CASE WHEN claim_type = 'owner'  THEN total_due_this_claim     ELSE 0 END) AS owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim     ELSE 0 END) AS vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) AS vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) AS invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
expenses_agg AS (
    SELECT project_id, 
           SUM(amount) AS total_employee_expenses,
           SUM(settled_amount) AS total_employee_expenses_paid
    FROM public.expenses
    WHERE status = 'approved'
      AND project_id IS NOT NULL
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) AS retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) AS total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, pa.allocated_amount, 'invoice' AS type
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    UNION ALL
    SELECT c.project_id, pa.allocated_amount, 'vendor_claim' AS type
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    UNION ALL
    SELECT r.project_id, pa.allocated_amount, 'retention' AS type
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
),
vendor_cash_split AS (
    SELECT 
        project_id, 
        SUM(allocated_amount) AS total_paid,
        SUM(CASE WHEN type = 'invoice' THEN allocated_amount ELSE 0 END) AS invoice_paid,
        SUM(CASE WHEN type = 'vendor_claim' THEN allocated_amount ELSE 0 END) AS vendor_claim_paid,
        SUM(CASE WHEN type = 'retention' THEN allocated_amount ELSE 0 END) AS retention_paid
    FROM vendor_allocations
    GROUP BY project_id
),
prior_vendor_claims_agg AS (
    SELECT
        project_id,
        SUM(prior_certified_amount) AS total_prior_certified,
        SUM(prior_paid_amount)      AS total_prior_paid,
        SUM(prior_retention_held)   AS total_prior_retention,
        COUNT(*)                    AS vendor_count
    FROM public.vendor_prior_claims
    GROUP BY project_id
),
inventory_receipts AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END)               AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END) AS total_value_in
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
),
inventory_avg_cost AS (
    SELECT
        ir.project_id,
        ir.item_id,
        CASE WHEN ir.total_qty_in > 0
             THEN ir.total_value_in / ir.total_qty_in
             ELSE 0
        END AS avg_cost
    FROM inventory_receipts ir
),
inventory_on_hand AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(sm.qty) AS qty_on_hand
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
    HAVING SUM(sm.qty) > 0
),
inventory_asset AS (
    SELECT
        ioh.project_id,
        SUM(ioh.qty_on_hand * iac.avg_cost) AS total_asset_value
    FROM inventory_on_hand ioh
    JOIN inventory_avg_cost iac
      ON iac.project_id = ioh.project_id
     AND iac.item_id    = ioh.item_id
    GROUP BY ioh.project_id
)
SELECT
    p.id   AS project_id,
    p.name,
    p.code,

    -- ? Opening balance metadata
    CASE WHEN ob.id IS NOT NULL THEN true ELSE false END  AS has_opening_balance,
    ob.cutoff_date                                         AS opening_cutoff_date,
    COALESCE(ob.prior_expenses,     0)                     AS prior_expenses,
    COALESCE(ob.prior_owner_income, 0)                     AS prior_owner_income,

    -- ? Vendor prior claims summary (informational)
    COALESCE(pvca.total_prior_certified,  0)               AS prior_vendor_certified,
    COALESCE(pvca.total_prior_paid,       0)               AS prior_vendor_paid,
    COALESCE(pvca.total_prior_retention,  0)               AS prior_vendor_retention,
    COALESCE(pvca.vendor_count,           0)               AS prior_vendor_count,

    -- ? In-system figures (Breakdown)
    COALESCE(pca.owner_billed,  0)                         AS owner_billed,
    COALESCE(oc.total_received, 0)                         AS owner_paid,
    
    COALESCE(pca.vendor_billed, 0)                         AS vendor_claims_billed,
    COALESCE(vcs.vendor_claim_paid, 0)                     AS vendor_claims_paid,
    
    COALESCE(ia.invoice_total, 0)                          AS invoices_billed,
    COALESCE(vcs.invoice_paid, 0)                          AS invoices_paid,
    
    COALESCE(ea.total_employee_expenses, 0)                AS employee_expenses_billed,
    COALESCE(ea.total_employee_expenses_paid, 0)           AS employee_expenses_paid,

    COALESCE(pca.vendor_retained, 0)
      - COALESCE(rra.retention_released, 0)               AS retention_held,

    -- ? Backward compatible in-system aggregations
    COALESCE(pca.owner_billed,  0)                         AS in_system_income,
    COALESCE(oc.total_received, 0)                         AS total_received,
    COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS in_system_expenses,
    COALESCE(vcs.total_paid, 0)                            AS total_paid,

    -- ? Inventory asset (items still in warehouse, avg cost)
    COALESCE(ia_asset.total_asset_value, 0)                AS inventory_asset_value,

    -- ? Grand totals
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)                      AS total_income,

    COALESCE(ob.prior_expenses, 0)
      + COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS total_expenses,

    -- balance = total_income ? total_expenses
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS balance,
      
    -- ? Profit (New calculations)
    (
      COALESCE(ob.prior_owner_income, 0) + COALESCE(pca.owner_billed, 0)
    ) - (
      (COALESCE(ob.prior_expenses, 0) + COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) + COALESCE(ea.total_employee_expenses, 0))
      - COALESCE(ia_asset.total_asset_value, 0)
    ) AS net_profit

FROM public.projects p
LEFT JOIN public.project_opening_balances ob  ON ob.project_id  = p.id
LEFT JOIN proj_claims_agg                 pca ON pca.project_id = p.id
LEFT JOIN invoices_agg                    ia  ON ia.project_id  = p.id
LEFT JOIN expenses_agg                    ea  ON ea.project_id  = p.id
LEFT JOIN retention_releases_agg          rra ON rra.project_id = p.id
LEFT JOIN owner_cash                      oc  ON oc.project_id  = p.id
LEFT JOIN vendor_cash_split               vcs ON vcs.project_id = p.id
LEFT JOIN prior_vendor_claims_agg         pvca ON pvca.project_id = p.id
LEFT JOIN inventory_asset                 ia_asset ON ia_asset.project_id = p.id;

-- ============================================================
-- FILE: 0033_bank_account_current_month.sql
-- ============================================================
-- 0033_bank_account_current_month.sql

DROP VIEW IF EXISTS public.v_bank_account_balances CASCADE;

CREATE OR REPLACE VIEW v_bank_account_balances WITH (security_invoker = true) AS
SELECT 
    ba.id AS bank_account_id,
    ba.bank_id,
    b.name AS bank_name,
    ba.account_name,
    ba.account_number,
    ba.currency,
    ba.opening_balance AS initial_balance,
    COALESCE(SUM(
        CASE 
            WHEN le.direction = 'in' THEN le.amount 
            WHEN le.direction = 'out' THEN -le.amount 
            ELSE 0 
        END
    ), 0) AS current_balance,
    COALESCE(SUM(
        CASE 
            WHEN le.direction = 'in' AND date_trunc('month', le.entry_date) = date_trunc('month', CURRENT_DATE) THEN le.amount 
            ELSE 0 
        END
    ), 0) AS current_month_in,
    COALESCE(SUM(
        CASE 
            WHEN le.direction = 'out' AND date_trunc('month', le.entry_date) = date_trunc('month', CURRENT_DATE) THEN le.amount 
            ELSE 0 
        END
    ), 0) AS current_month_out
FROM bank_accounts ba
JOIN banks b ON ba.bank_id = b.id
LEFT JOIN ledger_entries le ON ba.id = le.bank_account_id
GROUP BY ba.id, ba.bank_id, b.name, ba.account_name, ba.account_number, ba.currency, ba.opening_balance;

-- We also need to recreate v_bank_statement because CASCADE dropped it
CREATE OR REPLACE VIEW v_bank_statement WITH (security_invoker = true) AS
SELECT 
    le.id,
    le.bank_account_id,
    le.entry_date,
    le.created_at,
    le.direction,
    le.amount,
    le.category,
    le.memo,
    le.counterparty_type,
    le.counterparty_id,
    SUM(
        CASE 
            WHEN le.direction = 'in' THEN le.amount 
            WHEN le.direction = 'out' THEN -le.amount 
            ELSE 0 
        END
    ) OVER (
        PARTITION BY le.bank_account_id 
        ORDER BY le.entry_date ASC, le.created_at ASC
    ) AS running_balance
FROM ledger_entries le;

-- ============================================================
-- FILE: 0034_warehouse_valuation.sql
-- ============================================================
-- 0034_warehouse_valuation.sql

-- Drop view if it exists
DROP VIEW IF EXISTS public.v_warehouse_valuation CASCADE;

-- Create the view
CREATE OR REPLACE VIEW public.v_warehouse_valuation WITH (security_invoker = true) AS
WITH inventory_receipts AS (
    SELECT
        sm.item_id,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END) AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END) AS total_value_in
    FROM public.stock_movements sm
    GROUP BY sm.item_id
),
item_avg_cost AS (
    SELECT
        item_id,
        CASE WHEN total_qty_in > 0
             THEN total_value_in / total_qty_in
             ELSE 0
        END AS avg_cost
    FROM inventory_receipts
)
SELECT 
    v.warehouse_id,
    SUM(v.qty_on_hand * COALESCE(c.avg_cost, 0)) as total_value
FROM public.v_stock_on_hand v
LEFT JOIN item_avg_cost c ON c.item_id = v.item_id
GROUP BY v.warehouse_id;

-- ============================================================
-- FILE: 0035_claim_item_stock_bundles.sql
-- ============================================================
-- 0035_claim_item_stock_bundles.sql
-- Replaces the single warehouse_id / item_id on claim_items with a
-- bundle table: many warehouse-items per claim item, each with a
-- qty_per_unit factor.  On approval, qty_per_unit أ— current_qty is
-- deducted from stock for every row in the bundle.

-- 1. New bundle table
CREATE TABLE public.claim_item_stock_bundles (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_item_id uuid          NOT NULL REFERENCES public.claim_items(id) ON DELETE CASCADE,
  warehouse_id  uuid          NOT NULL REFERENCES public.warehouses(id),
  item_id       uuid          NOT NULL REFERENCES public.inventory_items(id),
  qty_per_unit  numeric(18,4) NOT NULL CHECK (qty_per_unit > 0),
  created_at    timestamptz   DEFAULT now()
);

CREATE INDEX idx_claim_item_bundles_item ON public.claim_item_stock_bundles(claim_item_id);

-- 2. RLS â€“ same scope as claim_items
ALTER TABLE public.claim_item_stock_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bundle rows selectable scoped"
  ON public.claim_item_stock_bundles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.claim_items ci
      JOIN public.claims c ON c.id = ci.claim_id
      WHERE ci.id = claim_item_id
        AND (public.is_super_admin() OR public.has_project_access(c.project_id))
    )
  );

CREATE POLICY "Bundle rows insertable scoped"
  ON public.claim_item_stock_bundles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.claim_items ci
      JOIN public.claims c ON c.id = ci.claim_id
      WHERE ci.id = claim_item_id
        AND (public.is_super_admin() OR public.has_project_access(c.project_id))
    )
  );

CREATE POLICY "Bundle rows deletable scoped"
  ON public.claim_item_stock_bundles
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.claim_items ci
      JOIN public.claims c ON c.id = ci.claim_id
      WHERE ci.id = claim_item_id
        AND (public.is_super_admin() OR public.has_project_access(c.project_id))
    )
  );

-- 3. Update approve_claim to handle both legacy (single item_id) and
--    new bundle rows.
CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status     text;
  v_emp_id     uuid;
  v_project_id uuid;
  v_item       record;
  v_bundle     record;
  v_on_hand    numeric;
  v_deduct_qty numeric;
BEGIN
  v_emp_id := public.current_employee_id();

  SELECT status, project_id
  INTO   v_status, v_project_id
  FROM   public.claims
  WHERE  id = p_claim_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  IF NOT public.has_project_access(v_project_id)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET    status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE  id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (v_emp_id, 'approve', 'claim', p_claim_id,
          jsonb_build_object('status', 'approved'));

  -- â”€â”€ New bundle-based deductions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  FOR v_item IN
    SELECT ci.id AS claim_item_id, ci.current_qty
    FROM   public.claim_items ci
    WHERE  ci.claim_id = p_claim_id
      AND  ci.is_stock_issue = true
  LOOP
    FOR v_bundle IN
      SELECT b.warehouse_id, b.item_id, b.qty_per_unit
      FROM   public.claim_item_stock_bundles b
      WHERE  b.claim_item_id = v_item.claim_item_id
    LOOP
      v_deduct_qty := v_bundle.qty_per_unit * v_item.current_qty;

      SELECT COALESCE(
        (SELECT qty_on_hand
         FROM   public.v_stock_on_hand
         WHERE  warehouse_id = v_bundle.warehouse_id
           AND  item_id      = v_bundle.item_id),
        0
      ) INTO v_on_hand;

      IF v_on_hand < v_deduct_qty THEN
        RAISE EXCEPTION
          'Insufficient stock for item % in warehouse %. Have %, need %',
          v_bundle.item_id, v_bundle.warehouse_id, v_on_hand, v_deduct_qty;
      END IF;

      INSERT INTO public.stock_movements (
        warehouse_id, item_id, movement_type, qty,
        reference_id, notes, created_by
      ) VALUES (
        v_bundle.warehouse_id, v_bundle.item_id,
        'issue', -v_deduct_qty,
        p_claim_id, 'Claim bundle issue', v_emp_id
      );
    END LOOP;

    -- â”€â”€ Legacy fallback: single item_id on claim_items (no bundle rows) â”€â”€
    IF NOT EXISTS (
      SELECT 1 FROM public.claim_item_stock_bundles
      WHERE claim_item_id = v_item.claim_item_id
    ) THEN
      -- Use old-style warehouse_id / item_id columns
      FOR v_bundle IN
        SELECT warehouse_id, item_id, current_qty AS qty_per_unit
        FROM   public.claim_items
        WHERE  id             = v_item.claim_item_id
          AND  warehouse_id   IS NOT NULL
          AND  item_id        IS NOT NULL
      LOOP
        SELECT COALESCE(
          (SELECT qty_on_hand
           FROM   public.v_stock_on_hand
           WHERE  warehouse_id = v_bundle.warehouse_id
             AND  item_id      = v_bundle.item_id),
          0
        ) INTO v_on_hand;

        IF v_on_hand < v_bundle.qty_per_unit THEN
          RAISE EXCEPTION
            'Insufficient stock for item % in warehouse % (legacy). Have %, need %',
            v_bundle.item_id, v_bundle.warehouse_id,
            v_on_hand, v_bundle.qty_per_unit;
        END IF;

        INSERT INTO public.stock_movements (
          warehouse_id, item_id, movement_type, qty,
          reference_id, notes, created_by
        ) VALUES (
          v_bundle.warehouse_id, v_bundle.item_id,
          'issue', -v_bundle.qty_per_unit,
          p_claim_id, 'Owner claim issue (legacy)', v_emp_id
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FILE: 0036_relax_claim_item_stock_issue_constraint.sql
-- ============================================================
-- 0036_relax_claim_item_stock_issue_constraint.sql
--
-- The old constraint (0014) required warehouse_id + item_id to be NOT NULL
-- whenever is_stock_issue = true. The new bundle system (0035) stores items
-- in claim_item_stock_bundles instead, so both columns are intentionally NULL
-- for new-style records. Relax the constraint to allow that.

ALTER TABLE public.claim_items
  DROP CONSTRAINT IF EXISTS chk_claim_item_stock_issue;

ALTER TABLE public.claim_items
  ADD CONSTRAINT chk_claim_item_stock_issue CHECK (
    -- Normal item â€” no stock deduction
    (is_stock_issue = false)
    OR
    -- New bundle-style: warehouse/item stored in claim_item_stock_bundles
    (is_stock_issue = true AND warehouse_id IS NULL AND item_id IS NULL)
    OR
    -- Legacy single-item style: both columns populated together
    (is_stock_issue = true AND warehouse_id IS NOT NULL AND item_id IS NOT NULL)
  );

-- ============================================================
-- FILE: 0037_fix_audit_log_action_check.sql
-- ============================================================
-- 0037_fix_audit_log_action_check.sql
--
-- The original constraint (0001) did not include 'reject', but several RPCs
-- (reject_claim, reject_invoice, reject_expense) write action='reject' to the
-- audit_log table. This migration widens the allowed set to include 'reject'.

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check CHECK (
    action IN ('create', 'update', 'delete', 'approve', 'reject', 'login', 'logout')
  );

-- ============================================================
-- FILE: 0038_reject_claim_deletes.sql
-- ============================================================
-- 0038_reject_claim_deletes.sql
--
-- Business rule change: rejecting a claim DELETES it entirely and reverts
-- the system to the previous approved claim. There is no "rejected" status.
-- This also fixes the audit_log constraint issue â€” we use action='delete'
-- which is already in the allowed list, so no constraint change needed.

CREATE OR REPLACE FUNCTION public.reject_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status     text;
  v_project_id uuid;
  v_party_id   uuid;
  v_claim_num  int;
BEGIN
  SELECT status, project_id, party_id, claim_number
    INTO v_status, v_project_id, v_party_id, v_claim_num
    FROM public.claims
   WHERE id = p_claim_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim not found';
  END IF;

  IF NOT (
    SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()
  ) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject claims';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Only pending claims can be rejected/deleted';
  END IF;

  -- Log the deletion BEFORE deleting (so audit record references a still-existing claim)
  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before)
  VALUES (
    public.current_employee_id(),
    'delete',
    'claim',
    p_claim_id,
    jsonb_build_object(
      'claim_number', v_claim_num,
      'party_id',     v_party_id,
      'project_id',   v_project_id,
      'status',       v_status,
      'reason',       'rejected â€” claim deleted and reverted to previous'
    )
  );

  -- Delete the claim; cascades to claim_items â†’ claim_item_stock_bundles, attachments, etc.
  DELETE FROM public.claims WHERE id = p_claim_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


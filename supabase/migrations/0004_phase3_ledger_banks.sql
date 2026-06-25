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

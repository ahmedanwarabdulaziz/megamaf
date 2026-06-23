-- Create bank_transactions table
CREATE TABLE bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
    amount NUMERIC(15, 2) NOT NULL,
    transaction_date DATE NOT NULL,
    description TEXT,
    reference_type TEXT,
    reference_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create certificates table
CREATE TABLE certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    bank_name TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EGP',
    start_date DATE NOT NULL,
    duration_months INTEGER NOT NULL,
    interest_rate NUMERIC(5, 2) NOT NULL,
    payout_frequency TEXT NOT NULL CHECK (payout_frequency IN ('monthly', 'quarterly', 'semi_annually', 'annually', 'at_maturity')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matured', 'broken')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies
CREATE POLICY "Users can view their own company's bank transactions" 
ON bank_transactions FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert their own company's bank transactions" 
ON bank_transactions FOR INSERT WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update their own company's bank transactions" 
ON bank_transactions FOR UPDATE USING (company_id = get_my_company_id());

CREATE POLICY "Users can delete their own company's bank transactions" 
ON bank_transactions FOR DELETE USING (company_id = get_my_company_id());

CREATE POLICY "Users can view their own company's certificates" 
ON certificates FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert their own company's certificates" 
ON certificates FOR INSERT WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update their own company's certificates" 
ON certificates FOR UPDATE USING (company_id = get_my_company_id());

CREATE POLICY "Users can delete their own company's certificates" 
ON certificates FOR DELETE USING (company_id = get_my_company_id());

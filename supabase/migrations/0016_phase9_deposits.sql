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

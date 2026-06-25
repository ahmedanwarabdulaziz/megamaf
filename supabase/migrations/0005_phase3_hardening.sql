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
        RAISE EXCEPTION 'رقم الحساب مسجل بالفعل';
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

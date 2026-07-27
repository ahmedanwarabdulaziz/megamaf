-- 20260727130300_banks_deposits_treasury_edit_access.sql
--
-- banks/deposits/treasury-custody write policies and RPCs already checked
-- has_page_access(slug) with no level distinction — a bare page grant was
-- already effectively "edit" for these modules. Update them to require the
-- 'edit' level explicitly now that view/edit levels exist, so a view-only
-- grant can no longer run these mutations. "select scoped" / SELECT policies
-- are untouched — they keep the 1-arg has_page_access() (view-or-above).

-- Using DROP + CREATE instead of ALTER POLICY: this repo's migrations/
-- folder does not necessarily match what has actually been applied to the
-- live database, so ALTER POLICY's "policy must already exist" requirement
-- is unsafe to rely on. DROP POLICY IF EXISTS + CREATE POLICY works whether
-- or not the policy currently exists.

-- ── banks ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Banks update scope" ON public.banks;
CREATE POLICY "Banks update scope" ON public.banks
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('banks', 'edit'));

DROP POLICY IF EXISTS "Bank accounts update scope" ON public.bank_accounts;
CREATE POLICY "Bank accounts update scope" ON public.bank_accounts
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('banks', 'edit'));

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
    IF NOT public.has_page_access('banks', 'edit') THEN
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
    IF NOT public.has_page_access('banks', 'edit') THEN
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
    IF NOT public.has_page_access('banks', 'edit') THEN
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

CREATE OR REPLACE FUNCTION public.update_bank_account_opening_balance(
    p_bank_account_id uuid,
    p_opening_balance numeric
) RETURNS void AS $$
DECLARE
    v_employee_id uuid;
    v_existing_ledger_id uuid;
    v_direction text;
    v_amount numeric;
BEGIN
    -- Permission check
    IF NOT public.has_page_access('banks', 'edit') THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_employee_id := public.current_employee_id();

    -- 1. Update the opening_balance column on bank_accounts
    UPDATE public.bank_accounts
    SET opening_balance = p_opening_balance,
        updated_at      = now()
    WHERE id = p_bank_account_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bank account not found: %', p_bank_account_id;
    END IF;

    -- 2. Find existing opening_balance ledger entry for this account
    SELECT id INTO v_existing_ledger_id
    FROM public.ledger_entries
    WHERE bank_account_id = p_bank_account_id
      AND category        = 'opening_balance'
    LIMIT 1;

    -- 3. Sync ledger
    IF p_opening_balance = 0 THEN
        -- Remove the ledger row if it exists
        IF v_existing_ledger_id IS NOT NULL THEN
            DELETE FROM public.ledger_entries WHERE id = v_existing_ledger_id;
        END IF;

    ELSE
        v_direction := CASE WHEN p_opening_balance > 0 THEN 'in' ELSE 'out' END;
        v_amount    := ABS(p_opening_balance);

        IF v_existing_ledger_id IS NOT NULL THEN
            -- Update existing row (ledger_entries has no updated_at column in this DB)
            UPDATE public.ledger_entries
            SET direction = v_direction,
                amount    = v_amount
            WHERE id = v_existing_ledger_id;
        ELSE
            -- Insert new opening balance row
            INSERT INTO public.ledger_entries (
                entry_date, direction, amount, category,
                bank_account_id, memo, created_by, counterparty_type
            ) VALUES (
                CURRENT_DATE,
                v_direction,
                v_amount,
                'opening_balance',
                p_bank_account_id,
                'Opening Balance',
                v_employee_id,
                'bank'
            );
        END IF;
    END IF;

    -- 4. Audit log
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_employee_id,
        'update',
        'bank_account',
        p_bank_account_id,
        jsonb_build_object('opening_balance', p_opening_balance)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── deposits ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Deposits modifiable by admins" ON public.deposits;
CREATE POLICY "Deposits modifiable by admins" ON public.deposits
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('deposits', 'edit'));

DROP POLICY IF EXISTS "Deposit payouts modifiable by admins" ON public.deposit_payouts;
CREATE POLICY "Deposit payouts modifiable by admins" ON public.deposit_payouts
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('deposits', 'edit'));

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

    IF NOT public.is_super_admin() AND NOT public.has_page_access('deposits', 'edit') THEN
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

-- return_deposit_principal — latest definition is in
-- 20260712150000_deposit_renewal_ignore_pending_payouts.sql (drops the
-- "all payouts collected" requirement present in the earlier version).
CREATE OR REPLACE FUNCTION public.return_deposit_principal(
    p_deposit_id uuid,
    p_actual_amount numeric,
    p_date date,
    p_bank_account_id uuid,
    p_notes text
)
RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_deposit record;
    v_ledger_id uuid;
BEGIN
    v_emp_id := public.current_employee_id();

    IF NOT public.is_super_admin() AND NOT public.has_page_access('deposits', 'edit') THEN
        RAISE EXCEPTION 'Not authorized to close deposits';
    END IF;

    SELECT * INTO v_deposit FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deposit not found';
    END IF;

    IF v_deposit.status <> 'active' THEN
        RAISE EXCEPTION 'This deposit is already closed';
    END IF;

    IF (v_deposit.start_date + (v_deposit.term_months || ' months')::interval) > now() THEN
        RAISE EXCEPTION 'This deposit has not reached its maturity date yet';
    END IF;

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id,
        source_type, source_id, memo, created_by
    ) VALUES (
        p_date, 'in', p_actual_amount, 'deposit_principal_return', p_bank_account_id,
        'deposit', p_deposit_id, 'Return of principal for ' || v_deposit.name || '. ' || COALESCE(p_notes, ''), v_emp_id
    ) RETURNING id INTO v_ledger_id;

    UPDATE public.deposits
    SET status = 'returned', closed_at = now(), return_ledger_entry_id = v_ledger_id
    WHERE id = p_deposit_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'update', 'deposit', p_deposit_id, jsonb_build_object(
        'status', 'returned',
        'return_amount', p_actual_amount,
        'bank_account_id', p_bank_account_id,
        'ledger_entry_id', v_ledger_id
    ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── treasury/custody ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Owner custody disbursements: insertable by treasury or admin" ON public.owner_custody_disbursements;
CREATE POLICY "Owner custody disbursements: insertable by treasury or admin" ON public.owner_custody_disbursements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_page_access('treasury/custody', 'edit') OR public.is_super_admin());

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
    IF NOT public.has_page_access('treasury/custody', 'edit') AND NOT public.is_super_admin() THEN
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

CREATE OR REPLACE FUNCTION public.delete_custody_disbursement(p_id uuid)
RETURNS void AS $$
DECLARE
    v_entry record;
BEGIN
    IF NOT public.has_page_access('treasury/custody', 'edit') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT * INTO v_entry FROM public.ledger_entries WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Entry not found';
    END IF;

    IF v_entry.category != 'custody_disbursement' THEN
        RAISE EXCEPTION 'Entry is not a custody disbursement';
    END IF;

    -- Delete the employee ledger entry
    DELETE FROM public.ledger_entries WHERE id = p_id;

    -- Delete the corresponding bank ledger entry
    DELETE FROM public.ledger_entries
    WHERE category = 'custody_disbursement'
      AND direction = 'out'
      AND bank_account_id = v_entry.counterparty_id
      AND counterparty_id = v_entry.employee_id
      AND amount = v_entry.amount
      AND created_at = v_entry.created_at;

    -- Recalculate employee balance
    PERFORM public.settle_employee_custody(v_entry.employee_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  IF NOT public.has_page_access('treasury/custody', 'edit') AND NOT public.is_super_admin() THEN
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

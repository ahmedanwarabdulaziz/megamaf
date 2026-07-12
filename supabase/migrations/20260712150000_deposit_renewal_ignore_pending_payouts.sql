-- 20260712150000_deposit_renewal_ignore_pending_payouts.sql
-- Drops the "all payouts collected" requirement for closing a matured deposit.
-- Some deposits are past their due dates with payouts never marked collected
-- in-app because they were folded into a bank account's opening balance
-- manually — those should still be returnable/renewable once matured.

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

    IF NOT public.is_super_admin() AND NOT public.has_page_access('deposits') THEN
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

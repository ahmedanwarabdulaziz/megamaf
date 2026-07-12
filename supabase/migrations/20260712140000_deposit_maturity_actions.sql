-- 20260712140000_deposit_maturity_actions.sql
-- Adds maturity handling for deposits/certificates: once matured (and fully
-- collected), a deposit can either be closed by returning its principal to a
-- bank account, or renewed into a fresh deposit that references it.

ALTER TABLE public.deposits
    ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'renewed')),
    ADD COLUMN renewed_from_id uuid REFERENCES public.deposits(id),
    ADD COLUMN closed_at timestamptz,
    ADD COLUMN return_ledger_entry_id uuid REFERENCES public.ledger_entries(id);

-- Allow the new ledger category used when principal is returned to a bank account
ALTER TABLE public.ledger_entries DROP CONSTRAINT ledger_entries_category_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_category_check CHECK (
    category IN (
        'opening_balance',
        'bank_in',
        'bank_out',
        'custody_disbursement',
        'vendor_payment',
        'owner_payment',
        'deposit_collection',
        'deposit_principal_return',
        'interest',
        'deduction',
        'transfer_in',
        'transfer_out'
    )
);

-- Return RPC: deposits the principal into a bank account and closes the deposit.
-- Mirrors collect_deposit_payout's auth/locking pattern.
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
    v_pending_count integer;
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

    SELECT count(*) INTO v_pending_count FROM public.deposit_payouts WHERE deposit_id = p_deposit_id AND is_collected = false;
    IF v_pending_count > 0 THEN
        RAISE EXCEPTION 'All payouts must be collected before closing this deposit';
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

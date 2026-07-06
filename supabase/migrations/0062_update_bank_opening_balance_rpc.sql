-- 0062_update_bank_opening_balance_rpc.sql
-- Atomic RPC to update bank account opening balance in both
-- bank_accounts table AND the corresponding ledger_entries row.
-- Runs as SECURITY DEFINER to bypass ledger RLS for this trusted operation.

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
    IF NOT public.has_page_access('banks') THEN
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

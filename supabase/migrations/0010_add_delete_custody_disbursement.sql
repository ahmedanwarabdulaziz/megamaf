CREATE OR REPLACE FUNCTION public.delete_custody_disbursement(p_id uuid)
RETURNS void AS $$
DECLARE
    v_entry record;
BEGIN
    IF NOT public.has_page_access('treasury/custody') AND NOT public.is_super_admin() THEN
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

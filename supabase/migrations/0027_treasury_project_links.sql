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

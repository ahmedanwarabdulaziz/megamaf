-- 0030_assign_owner_receipt.sql
-- RPC to retroactively assign an unlinked owner receipt to a project
-- and optionally allocate it to an owner claim.
-- This patches an existing ledger_entry in-place (updates project_id, replaces allocations).

CREATE OR REPLACE FUNCTION public.assign_owner_receipt(
    p_ledger_entry_id uuid,
    p_project_id      uuid,
    p_allocations     jsonb  -- Array of { target_type, target_id, amount }
) RETURNS void AS $$
DECLARE
    v_entry          record;
    v_alloc          jsonb;
    v_alloc_amount   numeric;
    v_total_alloc    numeric := 0;
    v_target_id      uuid;
    v_target_type    text;
    v_doc_party_id   uuid;
    v_doc_project_id uuid;
BEGIN
    -- ── Auth ────────────────────────────────────────────────────────────────
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to assign receipts';
    END IF;

    -- ── Load & validate the ledger entry ────────────────────────────────────
    SELECT * INTO v_entry FROM public.ledger_entries WHERE id = p_ledger_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ledger entry not found: %', p_ledger_entry_id;
    END IF;
    IF v_entry.counterparty_type <> 'owner' OR v_entry.direction <> 'in' THEN
        RAISE EXCEPTION 'Can only assign owner receipt entries (direction=in, counterparty_type=owner)';
    END IF;

    -- Project access
    IF NOT public.is_super_admin() AND NOT public.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized to assign to project %', p_project_id;
    END IF;

    -- ── Validate allocations ─────────────────────────────────────────────────
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount <= 0 THEN CONTINUE; END IF;

        v_total_alloc  := v_total_alloc + v_alloc_amount;
        v_target_id    := (v_alloc->>'target_id')::uuid;
        v_target_type  := v_alloc->>'target_type';

        IF v_target_type = 'claim' THEN
            SELECT party_id, project_id
            INTO   v_doc_party_id, v_doc_project_id
            FROM   public.claims
            WHERE  id = v_target_id AND claim_type = 'owner';

            IF v_doc_party_id IS NULL THEN
                RAISE EXCEPTION 'Owner claim not found: %', v_target_id;
            END IF;
            IF v_doc_party_id <> v_entry.counterparty_id THEN
                RAISE EXCEPTION 'Claim % does not belong to owner %', v_target_id, v_entry.counterparty_id;
            END IF;
            IF v_doc_project_id <> p_project_id THEN
                RAISE EXCEPTION 'Claim % belongs to project % not %', v_target_id, v_doc_project_id, p_project_id;
            END IF;
        ELSIF v_target_type = 'owner_schedule' THEN
            -- owner_schedule validation (party via project → owner)
            NULL; -- allow, owner_schedule is project-scoped
        ELSE
            RAISE EXCEPTION 'Unsupported allocation target_type for owner receipt: %', v_target_type;
        END IF;
    END LOOP;

    IF v_total_alloc > v_entry.amount THEN
        RAISE EXCEPTION 'Total allocations (%) exceed receipt amount (%)', v_total_alloc, v_entry.amount;
    END IF;

    -- ── Apply changes ────────────────────────────────────────────────────────
    -- 1. Update project_id on the ledger entry
    UPDATE public.ledger_entries
    SET    project_id = p_project_id
    WHERE  id = p_ledger_entry_id;

    -- 2. Clear any existing allocations (clean-slate re-assignment)
    DELETE FROM public.payment_allocations WHERE ledger_entry_id = p_ledger_entry_id;

    -- 3. Insert new allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount > 0 THEN
            INSERT INTO public.payment_allocations (ledger_entry_id, target_type, target_id, allocated_amount)
            VALUES (
                p_ledger_entry_id,
                v_alloc->>'target_type',
                (v_alloc->>'target_id')::uuid,
                v_alloc_amount
            );
        END IF;
    END LOOP;

    -- 4. Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        public.current_employee_id(),
        'update',
        'owner_receipt',
        p_ledger_entry_id,
        jsonb_build_object(
            'project_id',  p_project_id,
            'allocations', p_allocations
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

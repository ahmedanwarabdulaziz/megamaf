-- 0013_phase7_hardening.sql

-- FIX 1 & 6: Rewrite v_project_financial_position to derive cash from allocations and optimize claim totals
DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;
CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT 
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT 
        project_id,
        SUM(CASE WHEN claim_type = 'owner' THEN total_due_this_claim ELSE 0 END) as owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim ELSE 0 END) as vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) as vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) as invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) as retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) as total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
    UNION ALL
    SELECT c.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
    UNION ALL
    SELECT r.project_id, SUM(pa.allocated_amount) as amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
),
vendor_cash AS (
    SELECT project_id, SUM(amount) as total_paid
    FROM vendor_allocations
    GROUP BY project_id
)
SELECT 
    p.id AS project_id,
    p.name,
    p.code,
    COALESCE(pca.owner_billed, 0) AS total_income,
    COALESCE(oc.total_received, 0) AS total_received,
    COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) AS total_expenses,
    COALESCE(vc.total_paid, 0) AS total_paid,
    COALESCE(pca.vendor_retained, 0) - COALESCE(rra.retention_released, 0) AS retention_held,
    COALESCE(pca.owner_billed, 0) - (COALESCE(pca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0)) AS balance
FROM public.projects p
LEFT JOIN proj_claims_agg pca ON pca.project_id = p.id
LEFT JOIN invoices_agg ia ON ia.project_id = p.id
LEFT JOIN retention_releases_agg rra ON rra.project_id = p.id
LEFT JOIN owner_cash oc ON oc.project_id = p.id
LEFT JOIN vendor_cash vc ON vc.project_id = p.id;

-- FIX 2, 3, 4: Hardened record_vendor_payment
CREATE OR REPLACE FUNCTION public.record_vendor_payment(
    p_bank_account_id uuid,
    p_vendor_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb -- Array of { target_type, target_id, amount }
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
    v_target_id uuid;
    v_alloc_amount numeric;
    v_target_type text;
    
    v_doc_project_id uuid;
    v_doc_party_id uuid;
    v_doc_due numeric;
    v_doc_paid numeric;
BEGIN
    -- Authorization: Super admin or has treasury access
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    -- Pre-scan allocations for validity, party ownership, bounds, and project access
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount <= 0 THEN CONTINUE; END IF;
        
        v_total_allocated := v_total_allocated + v_alloc_amount;
        v_target_id := (v_alloc->>'target_id')::uuid;
        v_target_type := v_alloc->>'target_type';

        IF v_target_type = 'invoice' THEN
            SELECT vendor_id, project_id, total, (SELECT paid_amount FROM public.v_invoice_paid WHERE invoice_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.invoices WHERE id = v_target_id;
        ELSIF v_target_type = 'claim' THEN
            SELECT party_id, project_id, (SELECT total_due_this_claim FROM public.v_claim_totals WHERE claim_id = v_target_id), (SELECT paid_amount FROM public.v_claim_paid WHERE claim_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.claims WHERE id = v_target_id AND claim_type = 'vendor';
        ELSIF v_target_type = 'retention_release' THEN
            SELECT party_id, project_id, amount, (SELECT paid_amount FROM public.v_retention_paid WHERE retention_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.retention_releases WHERE id = v_target_id AND claim_type = 'vendor';
        ELSE
            RAISE EXCEPTION 'Invalid target_type for vendor payment: %', v_target_type;
        END IF;

        IF v_doc_party_id IS NULL THEN RAISE EXCEPTION 'Document % not found or invalid type', v_target_id; END IF;
        IF v_doc_party_id != p_vendor_id THEN RAISE EXCEPTION 'Document % does not belong to vendor %', v_target_id, p_vendor_id; END IF;
        
        -- Project access check
        IF NOT public.is_super_admin() AND NOT public.has_project_access(v_doc_project_id) THEN
            RAISE EXCEPTION 'Not authorized to allocate against project %', v_doc_project_id;
        END IF;

        -- Allocation bounds check
        IF v_alloc_amount > (v_doc_due - COALESCE(v_doc_paid, 0)) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %', v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed payment amount';
    END IF;

    -- Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'out', p_amount, 'vendor_payment', p_bank_account_id, 'vendor', p_vendor_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_alloc->>'target_type', (v_alloc->>'target_id')::uuid, v_alloc_amount
            );
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'vendor_payment', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FIX 2, 3, 4: Hardened record_owner_receipt
CREATE OR REPLACE FUNCTION public.record_owner_receipt(
    p_bank_account_id uuid,
    p_owner_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb -- Array of { target_type, target_id, amount }
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
    v_target_id uuid;
    v_alloc_amount numeric;
    v_target_type text;
    
    v_doc_project_id uuid;
    v_doc_party_id uuid;
    v_doc_due numeric;
    v_doc_paid numeric;
BEGIN
    -- Authorization
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to record receipts';
    END IF;

    -- Pre-scan allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount <= 0 THEN CONTINUE; END IF;
        
        v_total_allocated := v_total_allocated + v_alloc_amount;
        v_target_id := (v_alloc->>'target_id')::uuid;
        v_target_type := v_alloc->>'target_type';

        IF v_target_type = 'claim' THEN
            SELECT party_id, project_id, (SELECT total_due_this_claim FROM public.v_claim_totals WHERE claim_id = v_target_id), (SELECT paid_amount FROM public.v_claim_paid WHERE claim_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.claims WHERE id = v_target_id AND claim_type = 'owner';
        ELSIF v_target_type = 'owner_schedule' THEN
            SELECT po.id, s.project_id, s.expected_amount, (SELECT paid_amount FROM public.v_owner_schedule_paid WHERE schedule_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.owner_payment_schedule s
            JOIN public.projects p ON p.id = s.project_id
            JOIN public.project_owners po ON po.id = p.owner_id
            WHERE s.id = v_target_id;
        ELSE
            RAISE EXCEPTION 'Invalid target_type for owner receipt: %', v_target_type;
        END IF;

        IF v_doc_party_id IS NULL THEN RAISE EXCEPTION 'Document % not found or invalid type', v_target_id; END IF;
        IF v_doc_party_id != p_owner_id THEN RAISE EXCEPTION 'Document % does not belong to owner %', v_target_id, p_owner_id; END IF;
        
        -- Project access check
        IF NOT public.is_super_admin() AND NOT public.has_project_access(v_doc_project_id) THEN
            RAISE EXCEPTION 'Not authorized to allocate against project %', v_doc_project_id;
        END IF;

        -- Allocation bounds check
        IF v_alloc_amount > (v_doc_due - COALESCE(v_doc_paid, 0)) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %', v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed receipt amount';
    END IF;

    -- Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'in', p_amount, 'owner_payment', p_bank_account_id, 'owner', p_owner_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        v_target_id := (v_alloc->>'target_id')::uuid;
        v_target_type := v_alloc->>'target_type';
        IF v_alloc_amount > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_target_type, v_target_id, v_alloc_amount
            );

            IF v_target_type = 'owner_schedule' THEN
                UPDATE public.owner_payment_schedule ops
                SET status = CASE 
                    WHEN (SELECT COALESCE(SUM(allocated_amount), 0) FROM public.payment_allocations WHERE target_id = ops.id AND target_type = 'owner_schedule') >= ops.expected_amount THEN 'paid'
                    ELSE 'partial'
                END
                WHERE id = v_target_id;
            END IF;
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'owner_receipt', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FIX 5: Scope payment_allocations
DROP POLICY IF EXISTS "Allocations viewable by all authenticated" ON public.payment_allocations;
CREATE POLICY "Allocations viewable by all authenticated" ON public.payment_allocations 
FOR SELECT TO authenticated USING (
    public.is_super_admin() OR public.has_page_access('treasury')
);

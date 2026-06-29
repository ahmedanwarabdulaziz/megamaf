-- 0040_prior_claim_payment_support.sql
--
-- Allow record_vendor_payment to handle 'prior_claim' target_type.
-- Instead of inserting into payment_allocations (which doesn't support prior_claim),
-- the payment is recorded against vendor_prior_claims.prior_paid_amount directly.
-- The ledger entry is still created for the full payment amount, and the portion
-- allocated to prior claims updates the static prior_paid_amount field.
--
-- This fixes the case where:
--   - A vendor has a vendor_prior_claims entry with outstanding balance
--   - The payment page shows this as an open document
--   - The user tries to pay it but the RPC fails with "Invalid target_type"

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
            SELECT party_id, project_id,
                   (SELECT total_due_this_claim FROM public.v_claim_totals WHERE claim_id = v_target_id),
                   (SELECT paid_amount FROM public.v_claim_paid WHERE claim_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.claims WHERE id = v_target_id AND claim_type = 'vendor';
        ELSIF v_target_type = 'retention_release' THEN
            SELECT party_id, project_id, amount, (SELECT paid_amount FROM public.v_retention_paid WHERE retention_id = v_target_id)
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.retention_releases WHERE id = v_target_id AND claim_type = 'vendor';
        ELSIF v_target_type = 'prior_claim' THEN
            -- Prior claim: target_id is vendor_prior_claims.id
            SELECT vendor_id, project_id,
                   prior_certified_amount,
                   prior_paid_amount
            INTO v_doc_party_id, v_doc_project_id, v_doc_due, v_doc_paid
            FROM public.vendor_prior_claims WHERE id = v_target_id;
        ELSE
            RAISE EXCEPTION 'Invalid target_type for vendor payment: %', v_target_type;
        END IF;

        IF v_doc_party_id IS NULL THEN
            RAISE EXCEPTION 'Document % not found or invalid type', v_target_id;
        END IF;
        IF v_doc_party_id != p_vendor_id THEN
            RAISE EXCEPTION 'Document % does not belong to vendor %', v_target_id, p_vendor_id;
        END IF;

        -- Project access check
        IF NOT public.is_super_admin() AND NOT public.has_project_access(v_doc_project_id) THEN
            RAISE EXCEPTION 'Not authorized to allocate against project %', v_doc_project_id;
        END IF;

        -- Allocation bounds check
        IF v_alloc_amount > (v_doc_due - COALESCE(v_doc_paid, 0)) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %',
                v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed payment amount';
    END IF;

    -- Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id,
        counterparty_type, counterparty_id, project_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'out', p_amount, 'vendor_payment', p_bank_account_id,
        'vendor', p_vendor_id, p_project_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations (for standard types) or update prior_paid_amount (for prior_claim)
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        v_target_type := v_alloc->>'target_type';
        v_target_id   := (v_alloc->>'target_id')::uuid;

        IF v_alloc_amount > 0 THEN
            IF v_target_type = 'prior_claim' THEN
                -- Update vendor_prior_claims directly instead of payment_allocations
                UPDATE public.vendor_prior_claims
                SET prior_paid_amount = prior_paid_amount + v_alloc_amount
                WHERE id = v_target_id AND vendor_id = p_vendor_id;
            ELSE
                INSERT INTO public.payment_allocations (
                    ledger_entry_id, target_type, target_id, allocated_amount
                ) VALUES (
                    v_ledger_id, v_target_type, v_target_id, v_alloc_amount
                );
            END IF;
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        public.current_employee_id(), 'create', 'vendor_payment', v_ledger_id,
        jsonb_build_object('amount', p_amount, 'allocations', p_allocations)
    );

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Helper RPC: pay_prior_claim ─────────────────────────────────────────────
-- Called from payVendor() server action for prior_claim allocations.
-- Uses SECURITY DEFINER to bypass the super-admin-only RLS on vendor_prior_claims.
-- Authorization: treasury page access or super admin.

CREATE OR REPLACE FUNCTION public.pay_prior_claim(
    p_prior_claim_id uuid,
    p_vendor_id      uuid,
    p_amount         numeric
) RETURNS void AS $$
DECLARE
    v_certified  numeric;
    v_paid       numeric;
    v_project_id uuid;
    v_party_id   uuid;
BEGIN
    -- Authorization
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    SELECT vendor_id, project_id, prior_certified_amount, prior_paid_amount
    INTO v_party_id, v_project_id, v_certified, v_paid
    FROM public.vendor_prior_claims
    WHERE id = p_prior_claim_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Prior claim % not found', p_prior_claim_id;
    END IF;
    IF v_party_id != p_vendor_id THEN
        RAISE EXCEPTION 'Prior claim does not belong to vendor %', p_vendor_id;
    END IF;
    IF p_amount > (v_certified - v_paid) THEN
        RAISE EXCEPTION 'Payment amount % exceeds outstanding prior balance %', p_amount, (v_certified - v_paid);
    END IF;

    -- Project access
    IF NOT public.is_super_admin() AND NOT public.has_project_access(v_project_id) THEN
        RAISE EXCEPTION 'Not authorized on project %', v_project_id;
    END IF;

    UPDATE public.vendor_prior_claims
    SET prior_paid_amount = prior_paid_amount + p_amount
    WHERE id = p_prior_claim_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

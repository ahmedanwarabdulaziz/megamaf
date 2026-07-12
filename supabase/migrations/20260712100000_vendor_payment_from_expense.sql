-- 20260712100000_vendor_payment_from_expense.sql
--
-- Allow a vendor invoice/claim/retention_release (or prior_claim) to be paid using
-- an employee's already-approved expense as the funding source, instead of a bank
-- account. This covers the case where an employee already paid a vendor directly
-- out of an approved expense/custody spend, and that spend now needs to be
-- formally recorded as a vendor payment.
--
-- Design (mirrors record_vendor_payment exactly, see 0040_prior_claim_payment_support.sql):
--   - One ledger_entries row is still created (direction='out', category='vendor_payment'),
--     but bank_account_id is NULL (no bank balance is touched — the cash already left
--     when the expense was incurred) and employee_id/source_type/source_id link it back
--     to the funding expense (reusing the existing-but-unused source_type/source_id columns).
--   - payment_allocations rows are inserted exactly as with bank-funded payments, so
--     v_invoice_paid / v_claim_paid / v_retention_paid / v_vendor_account all pick this
--     up automatically with zero changes.
--   - This is intentionally independent of settle_employee_custody(): that RPC keeps
--     reconciling how much of the employee's custody advance has been accounted for,
--     regardless of which vendor (if any) the spend is now being cross-referenced to.

CREATE OR REPLACE VIEW public.v_expense_vendor_paid WITH (security_invoker = true) AS
SELECT
    e.id AS expense_id,
    COALESCE(SUM(le.amount), 0) AS paid_amount
FROM public.expenses e
LEFT JOIN public.ledger_entries le
    ON le.source_type = 'expense'
   AND le.source_id = e.id
   AND le.category = 'vendor_payment'
GROUP BY e.id;

CREATE OR REPLACE FUNCTION public.record_vendor_payment_from_expense(
    p_employee_id uuid,
    p_expense_id  uuid,
    p_vendor_id   uuid,
    p_amount      numeric,
    p_memo        text,
    p_allocations jsonb, -- Array of { target_type, target_id, amount }
    p_project_id  uuid DEFAULT NULL
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

    v_expense_employee_id uuid;
    v_expense_status text;
    v_expense_amount numeric;
    v_expense_paid numeric;
BEGIN
    -- Authorization: same as bank-funded vendor payments
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    -- Validate the funding expense and its remaining unused balance
    SELECT employee_id, status, amount
    INTO v_expense_employee_id, v_expense_status, v_expense_amount
    FROM public.expenses WHERE id = p_expense_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense % not found', p_expense_id;
    END IF;
    IF v_expense_employee_id IS DISTINCT FROM p_employee_id THEN
        RAISE EXCEPTION 'Expense does not belong to the selected employee';
    END IF;
    IF v_expense_status != 'approved' THEN
        RAISE EXCEPTION 'Expense must be approved to fund a vendor payment';
    END IF;

    SELECT paid_amount INTO v_expense_paid FROM public.v_expense_vendor_paid WHERE expense_id = p_expense_id;
    v_expense_paid := COALESCE(v_expense_paid, 0);

    IF p_amount > (v_expense_amount - v_expense_paid) THEN
        RAISE EXCEPTION 'Amount % exceeds the expense remaining unused balance %', p_amount, (v_expense_amount - v_expense_paid);
    END IF;

    -- Pre-scan allocations for validity, party ownership, bounds, and project access
    -- (identical rules to record_vendor_payment)
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
            SELECT vendor_id, project_id, prior_certified_amount, prior_paid_amount
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

        IF NOT public.is_super_admin() AND NOT public.has_project_access(v_doc_project_id) THEN
            RAISE EXCEPTION 'Not authorized to allocate against project %', v_doc_project_id;
        END IF;

        IF v_alloc_amount > (v_doc_due - COALESCE(v_doc_paid, 0)) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %',
                v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed payment amount';
    END IF;

    -- Insert Ledger Entry — no bank account; funded from the employee's expense.
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, employee_id,
        counterparty_type, counterparty_id, project_id, source_type, source_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'out', p_amount, 'vendor_payment', NULL, p_employee_id,
        'vendor', p_vendor_id, p_project_id, 'expense', p_expense_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations (for standard types) or update prior_paid_amount (for prior_claim)
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        v_target_type := v_alloc->>'target_type';
        v_target_id   := (v_alloc->>'target_id')::uuid;

        IF v_alloc_amount > 0 THEN
            IF v_target_type = 'prior_claim' THEN
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
        public.current_employee_id(), 'create', 'vendor_payment_from_expense', v_ledger_id,
        jsonb_build_object('amount', p_amount, 'expense_id', p_expense_id, 'employee_id', p_employee_id, 'allocations', p_allocations)
    );

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

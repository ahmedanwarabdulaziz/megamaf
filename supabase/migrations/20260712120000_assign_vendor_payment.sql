-- 20260712120000_assign_vendor_payment.sql
--
-- Vendor-side equivalent of assign_owner_receipt() (0030_assign_owner_receipt.sql).
-- Retroactively allocates an existing, currently-unallocated vendor payment
-- (ledger_entries row with no payment_allocations rows) to specific documents
-- (invoice / claim / retention_release / prior_claim), and/or fixes its project_id.
--
-- Needed because record_vendor_payment(_from_expense) lets a payment be recorded
-- with allocations: [] (a deliberate "credit balance" feature for advance payments),
-- but that means such payments never reduce any specific document's due amount —
-- discovered when auditing why a claim's "remaining" didn't reflect an old payment
-- that was tagged with the right project but never actually allocated to it.

CREATE OR REPLACE FUNCTION public.assign_vendor_payment(
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
    v_doc_due        numeric;
    v_doc_paid       numeric;
BEGIN
    -- Auth
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to assign payments';
    END IF;

    -- Load & validate the ledger entry
    SELECT * INTO v_entry FROM public.ledger_entries WHERE id = p_ledger_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ledger entry not found: %', p_ledger_entry_id;
    END IF;
    IF v_entry.counterparty_type <> 'vendor' OR v_entry.direction <> 'out' THEN
        RAISE EXCEPTION 'Can only assign vendor payment entries (direction=out, counterparty_type=vendor)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.payment_allocations WHERE ledger_entry_id = p_ledger_entry_id) THEN
        RAISE EXCEPTION 'This payment already has allocations — reverse it first if you need to reassign it';
    END IF;

    -- Project access
    IF NOT public.is_super_admin() AND NOT public.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized to assign to project %', p_project_id;
    END IF;

    -- Validate allocations (same rules as record_vendor_payment)
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount <= 0 THEN CONTINUE; END IF;

        v_total_alloc := v_total_alloc + v_alloc_amount;
        v_target_id   := (v_alloc->>'target_id')::uuid;
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
        IF v_doc_party_id != v_entry.counterparty_id THEN
            RAISE EXCEPTION 'Document % does not belong to vendor %', v_target_id, v_entry.counterparty_id;
        END IF;
        IF v_doc_project_id <> p_project_id THEN
            RAISE EXCEPTION 'Document % belongs to project % not %', v_target_id, v_doc_project_id, p_project_id;
        END IF;
        IF v_alloc_amount > (v_doc_due - COALESCE(v_doc_paid, 0)) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %',
                v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF v_total_alloc > v_entry.amount THEN
        RAISE EXCEPTION 'Total allocations (%) exceed payment amount (%)', v_total_alloc, v_entry.amount;
    END IF;

    -- Apply changes
    UPDATE public.ledger_entries SET project_id = p_project_id WHERE id = p_ledger_entry_id;

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        v_target_type  := v_alloc->>'target_type';
        v_target_id    := (v_alloc->>'target_id')::uuid;

        IF v_alloc_amount > 0 THEN
            IF v_target_type = 'prior_claim' THEN
                UPDATE public.vendor_prior_claims
                SET prior_paid_amount = prior_paid_amount + v_alloc_amount
                WHERE id = v_target_id AND vendor_id = v_entry.counterparty_id;
            ELSE
                INSERT INTO public.payment_allocations (ledger_entry_id, target_type, target_id, allocated_amount)
                VALUES (p_ledger_entry_id, v_target_type, v_target_id, v_alloc_amount);
            END IF;
        END IF;
    END LOOP;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        public.current_employee_id(), 'update', 'vendor_payment', p_ledger_entry_id,
        jsonb_build_object('project_id', p_project_id, 'allocations', p_allocations)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

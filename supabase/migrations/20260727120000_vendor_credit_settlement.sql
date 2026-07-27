-- 20260727120000_vendor_credit_settlement.sql
--
-- Lets a vendor's existing unallocated payment (a "credit balance" — see
-- 20260712120000_assign_vendor_payment.sql) be drawn down gradually across
-- several documents over time, instead of only once.
--
-- Confirmed live on 2026-07-27: vendor "الروماني يسري" has a 100,248 ledger
-- payment with zero payment_allocations rows (pure advance/credit), while a
-- new 100 invoice for the same vendor sits unpaid. The user wants to settle
-- that invoice from the existing credit rather than record new cash — and,
-- since the invoice is tiny relative to the credit, the leftover balance
-- must remain usable for future documents.
--
-- 1) assign_vendor_payment() currently raises if the ledger entry already has
--    ANY payment_allocations rows ("reverse it first if you need to
--    reassign it"), so the very first partial draw-down would lock out every
--    later one. Replace that guard with a running-total check: sum what's
--    already allocated to this entry, and only reject if the NEW allocations
--    would push the total past the entry's amount. Also stop force-updating
--    ledger_entries.project_id on every call — once a first assignment has
--    tagged it, later incremental draws (possibly against a different
--    project) must not silently retag the whole entry.
--
-- 2) Add v_vendor_unallocated_credit so the UI can list, per vendor, which
--    ledger entries still have money left to allocate and how much.

CREATE OR REPLACE FUNCTION public.assign_vendor_payment(
    p_ledger_entry_id uuid,
    p_project_id      uuid,
    p_allocations     jsonb  -- Array of { target_type, target_id, amount }
) RETURNS void AS $$
DECLARE
    v_entry            record;
    v_alloc            jsonb;
    v_alloc_amount     numeric;
    v_total_alloc      numeric := 0;
    v_already_allocated numeric;
    v_target_id        uuid;
    v_target_type      text;
    v_doc_party_id     uuid;
    v_doc_project_id   uuid;
    v_doc_due          numeric;
    v_doc_paid         numeric;
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

    SELECT COALESCE(SUM(allocated_amount), 0) INTO v_already_allocated
    FROM public.payment_allocations WHERE ledger_entry_id = p_ledger_entry_id;

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

    IF (v_total_alloc + v_already_allocated) > v_entry.amount THEN
        RAISE EXCEPTION 'Total allocations (%) plus already-allocated (%) exceed payment amount (%)',
            v_total_alloc, v_already_allocated, v_entry.amount;
    END IF;

    -- Tag the ledger entry with a project only the first time it's assigned —
    -- later incremental draws against a different project must not retag it.
    UPDATE public.ledger_entries SET project_id = p_project_id
    WHERE id = p_ledger_entry_id AND project_id IS NULL;

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

-- Per-ledger-entry remaining credit for a vendor: the payment amount minus
-- whatever's already been allocated to invoices/claims/retentions out of it.
-- Excludes prior_claim draws, which aren't tracked in payment_allocations at
-- all (assign_vendor_payment routes those into vendor_prior_claims directly)
-- — a known pre-existing gap, not something this view can see.
CREATE OR REPLACE VIEW public.v_vendor_unallocated_credit WITH (security_invoker = true) AS
SELECT
    le.id                                          AS ledger_entry_id,
    le.counterparty_id                             AS vendor_id,
    le.entry_date,
    le.amount,
    le.amount - COALESCE(pa.allocated_sum, 0)      AS remaining_credit,
    le.project_id,
    le.memo
FROM public.ledger_entries le
LEFT JOIN (
    SELECT ledger_entry_id, SUM(allocated_amount) AS allocated_sum
    FROM public.payment_allocations
    GROUP BY ledger_entry_id
) pa ON pa.ledger_entry_id = le.id
WHERE le.counterparty_type = 'vendor'
  AND le.direction = 'out'
  AND (le.amount - COALESCE(pa.allocated_sum, 0)) > 0.01;

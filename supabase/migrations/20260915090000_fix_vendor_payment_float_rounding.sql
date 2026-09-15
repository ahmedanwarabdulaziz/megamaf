-- 20260915090000_fix_vendor_payment_float_rounding.sql
--
-- Bug: paying vendor "احمد ربيع الحداد" (claim/document c9acac2e-d2b3-43bc-
-- 9deb-5adcb935053b) from an employee's custody failed with:
--   "Allocation of 13745.130000000001 exceeds remaining due 13745.1300000000"
--
-- Root cause: calculator.tsx computes the allocation amount client-side in
-- JS (Math.min(remaining, remainingDue, capLeft), where remainingDue/capLeft
-- are themselves sums/subtractions of several claim rows via reduce()).
-- JS numbers are IEEE-754 doubles, so chained arithmetic on decimal amounts
-- can leave a ~1e-12 residual (13745.130000000001) even though the value is
-- "really" 13745.13. The RPC recomputes remaining due from NUMERIC columns
-- server-side (exact decimal arithmetic, no residual) and rejects because
-- the client's value is fractionally larger. Other vendors' documents
-- happen not to hit a chain of arithmetic that lands on the wrong side of
-- the true value, so they don't trip the check — but any vendor/claim can,
-- depending on the specific numbers involved.
--
-- Fix: money has no meaning below the cent, so round both sides of every
-- such bounds check to 2 decimal places before comparing. This absorbs
-- float noise from the client (or from any future caller) without
-- weakening the actual business rule (allocations still cannot exceed the
-- true remaining due/balance by so much as a cent). This is also correct
-- for a different reason: v_claim_totals computes total_due_this_claim via
-- `... * c.tax_rate` with no rounding, so a claim's true due amount can
-- legitimately carry sub-cent precision that the UI never shows (it only
-- ever displays/offers the 2-decimal figure) — rounding here makes the
-- check agree with what the user actually saw, not just paper over noise.
--
-- Same client-float-vs-server-numeric mismatch, same fix, applied to every
-- analogous check in these RPCs, not just the one that happened to be
-- reported:
--   - record_vendor_payment / record_vendor_payment_from_expense: the
--     per-document "exceeds remaining due" check AND the
--     "total allocated cannot exceed payment amount" check (p_amount and
--     the allocations sum are set independently in calculator.tsx, so they
--     can drift from each other by the same kind of residue).
--   - record_vendor_payment_from_expense: the "amount exceeds expense
--     remaining balance" check (p_amount is seeded from a client-computed
--     `exp.available`, compared against a fresh server subtraction).
--   - assign_vendor_payment: the per-document check AND the
--     "total allocations plus already-allocated exceed payment amount"
--     check.
--   - record_owner_receipt / assign_owner_receipt: no per-document check,
--     but the same "total allocated vs entry amount" pattern exists and is
--     rounded here too for consistency, even though no failure has been
--     reported on that path yet.

-- Latest definition before this fix: 20260828120000_vendor_payment_duplicate_guard.sql
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

    v_duplicate_id uuid;
BEGIN
    -- Authorization: Super admin or has treasury access
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury', 'edit') THEN
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    -- Duplicate-submission guard — see 20260828120000_vendor_payment_duplicate_guard.sql
    SELECT id INTO v_duplicate_id
    FROM public.ledger_entries
    WHERE category = 'vendor_payment'
      AND counterparty_type = 'vendor'
      AND counterparty_id = p_vendor_id
      AND bank_account_id IS NOT DISTINCT FROM p_bank_account_id
      AND amount = p_amount
      AND project_id IS NOT DISTINCT FROM p_project_id
      AND COALESCE(memo, '') = COALESCE(p_memo, '')
      AND created_by = public.current_employee_id()
      AND created_at > now() - interval '3 minutes'
    LIMIT 1;

    IF v_duplicate_id IS NOT NULL THEN
        RAISE EXCEPTION 'يبدو أن نفس الدفعة (% لهذا المقاول) تم تسجيلها للتو خلال آخر 3 دقائق — تحقق من كشف حساب المقاول قبل إعادة المحاولة لتفادي التكرار', p_amount;
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

        -- Allocation bounds check — rounded to cents so client-side float
        -- residue (e.g. 13745.130000000001) doesn't fail against the exact
        -- NUMERIC remaining due (13745.13). See migration header.
        IF ROUND(v_alloc_amount, 2) > ROUND(v_doc_due - COALESCE(v_doc_paid, 0), 2) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %',
                v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF ROUND(v_total_allocated, 2) > ROUND(p_amount, 2) THEN
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

-- Latest definition before this fix: 20260828120000_vendor_payment_duplicate_guard.sql
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
    v_expense_is_direct boolean;

    v_duplicate_id uuid;
BEGIN
    -- Authorization: same as bank-funded vendor payments
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    -- Duplicate-submission guard — see 20260828120000_vendor_payment_duplicate_guard.sql
    SELECT id INTO v_duplicate_id
    FROM public.ledger_entries
    WHERE category = 'vendor_payment'
      AND counterparty_type = 'vendor'
      AND counterparty_id = p_vendor_id
      AND source_type = 'expense'
      AND source_id = p_expense_id
      AND amount = p_amount
      AND project_id IS NOT DISTINCT FROM p_project_id
      AND created_by = public.current_employee_id()
      AND created_at > now() - interval '3 minutes'
    LIMIT 1;

    IF v_duplicate_id IS NOT NULL THEN
        RAISE EXCEPTION 'يبدو أن نفس الدفعة (% لهذا المقاول) تم تسجيلها للتو خلال آخر 3 دقائق — تحقق من كشف حساب المقاول قبل إعادة المحاولة لتفادي التكرار', p_amount;
    END IF;

    -- Validate the funding expense and its remaining unused balance
    SELECT employee_id, status, amount, is_direct
    INTO v_expense_employee_id, v_expense_status, v_expense_amount, v_expense_is_direct
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
    IF v_expense_is_direct THEN
        RAISE EXCEPTION 'A direct expense is already fully settled and cannot fund a vendor payment';
    END IF;

    SELECT paid_amount INTO v_expense_paid FROM public.v_expense_vendor_paid WHERE expense_id = p_expense_id;
    v_expense_paid := COALESCE(v_expense_paid, 0);

    IF ROUND(p_amount, 2) > ROUND(v_expense_amount - v_expense_paid, 2) THEN
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

        -- Allocation bounds check — rounded to cents; see migration header.
        IF ROUND(v_alloc_amount, 2) > ROUND(v_doc_due - COALESCE(v_doc_paid, 0), 2) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %',
                v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF ROUND(v_total_allocated, 2) > ROUND(p_amount, 2) THEN
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

-- Latest definition before this fix: 20260727130400_fix_treasury_slug.sql
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
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury', 'edit') THEN
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
        -- Allocation bounds check — rounded to cents; see migration header.
        IF ROUND(v_alloc_amount, 2) > ROUND(v_doc_due - COALESCE(v_doc_paid, 0), 2) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %',
                v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF ROUND(v_total_alloc + v_already_allocated, 2) > ROUND(v_entry.amount, 2) THEN
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

-- Latest definition before this fix: 0027_treasury_project_links.sql
-- (record_vendor_payment half of that migration is untouched here — it has
-- no per-document or total-vs-amount bound check at all, so it isn't part
-- of this fix; see 20260828120000_vendor_payment_duplicate_guard.sql for
-- the version of record_vendor_payment that IS current and IS fixed above.)
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

    -- Rounded to cents; see migration header.
    IF ROUND(v_total_allocated, 2) > ROUND(p_amount, 2) THEN
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

-- Latest definition before this fix: 20260727130400_fix_treasury_slug.sql
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
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury', 'edit') THEN
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

    -- Rounded to cents; see migration header.
    IF ROUND(v_total_alloc, 2) > ROUND(v_entry.amount, 2) THEN
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

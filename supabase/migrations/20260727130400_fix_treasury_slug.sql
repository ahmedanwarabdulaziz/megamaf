-- 20260727130400_fix_treasury_slug.sql
--
-- Separate latent bug found alongside the inventory one: several vendor/owner
-- payment-recording RPCs guard themselves with has_page_access('treasury'),
-- but 'treasury' was never a real grantable slug in EMPLOYEE_PAGES
-- (lib/page-access.ts) — only 'treasury/custody' existed. So these checks
-- could never pass for anyone but a super-admin, and the page that reaches
-- them (/treasury/pay/[vendorId]) had no page guard of its own either.
--
-- Fix: 'treasury' is now a real slug (see lib/page-access.ts) and
-- app/(app)/treasury/pay/[vendorId]/page.tsx now calls
-- requirePageAccess('treasury'). This migration updates every RPC that
-- checked has_page_access('treasury') to require the 'edit' level, now that
-- view/edit levels exist.
--
-- record_owner_receipt is NOT included here — its latest definition
-- (0027_treasury_project_links.sql) already moved off has_page_access
-- entirely, onto the can_approve flag.

-- Latest definition: 0040_prior_claim_payment_support.sql
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
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury', 'edit') THEN
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

-- Latest definition: 0040_prior_claim_payment_support.sql
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
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury', 'edit') THEN
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

-- Only definition: 0030_assign_owner_receipt.sql
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

-- Latest definition: 20260714090000_direct_expense.sql
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
BEGIN
    -- Authorization: same as bank-funded vendor payments
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury', 'edit') THEN
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
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

-- Latest definition: 20260727120000_vendor_credit_settlement.sql
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

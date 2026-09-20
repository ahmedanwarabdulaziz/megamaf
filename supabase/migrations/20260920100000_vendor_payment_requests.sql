-- 20260920100000_vendor_payment_requests.sql
--
-- New feature: an employee flagged with employees.has_expense_funding_access
-- (the same flag that lets them pick a funding source on an expense) can, on
-- the vendor payment screen, register a payment to a vendor that is funded
-- from a bank account or ANOTHER employee's custody — but it is NOT executed
-- immediately. It is saved as a pending request and only lands on the vendor's
-- account (ledger row + payment allocations) at the moment an approver
-- (can_approve / super admin) approves it in /expenses/approvals.
--
-- Same shape as the expense funding-source feature
-- (20260814150000_expense_funding_source.sql) and the salary loans
-- (20260805100000_bank_loan_approval.sql): a pending record + a side "how is
-- this funded" description, resolved atomically inside a single approve
-- function. Nothing is created on the vendor's account until approval
-- succeeds, so a rejection is just a status change.
--
-- The existing record_vendor_payment / record_vendor_payment_from_expense /
-- pay_prior_claim / assign_vendor_payment functions are deliberately NOT
-- touched: this is a live financial system with no staging, so the new flow
-- is fully additive and admin/treasury-editor payments behave exactly as before.
--
-- Money movement at approval:
--   'bank'             -> one vendor_payment ledger row out of that bank account
--                         (identical to record_vendor_payment).
--   'employee_custody' -> a real, already-approved mirror expense is booked
--                         against the funding employee (fixed category,
--                         main-company project — the vendor's cost is already
--                         carried by its claims/invoices, so it must not hit a
--                         project a second time), flowing through the SAME
--                         settle_employee_custody FIFO as any approved expense.
--                         A vendor_payment ledger row (bank NULL, employee_id =
--                         funding employee, source = that mirror expense) is
--                         written exactly as record_vendor_payment_from_expense
--                         writes it, so v_expense_vendor_paid marks the mirror
--                         expense fully used and it can never fund a second payment.

-- ============================================================================
-- 1. Fixed mirror-expense category for custody-funded vendor payments.
-- ============================================================================

INSERT INTO public.expense_categories (id, name, is_active)
VALUES ('00000000-0000-0000-0000-000000000012', 'سداد مقاول من عهدة موظف', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.expense_category_scopes (category_id, scope)
SELECT '00000000-0000-0000-0000-000000000012', 'main_company'
WHERE NOT EXISTS (
    SELECT 1 FROM public.expense_category_scopes
    WHERE category_id = '00000000-0000-0000-0000-000000000012' AND scope = 'main_company'
);

-- ============================================================================
-- 2. vendor_payment_requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vendor_payment_requests (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id                uuid NOT NULL REFERENCES public.vendors(id),
    project_id               uuid REFERENCES public.projects(id),
    amount                   numeric NOT NULL CHECK (amount > 0),
    memo                     text,
    allocations              jsonb NOT NULL DEFAULT '[]'::jsonb,
    funding_type             text NOT NULL CHECK (funding_type IN ('bank', 'employee_custody')),
    funding_bank_account_id  uuid REFERENCES public.bank_accounts(id),
    funding_employee_id      uuid REFERENCES public.employees(id),
    status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by             uuid NOT NULL REFERENCES public.employees(id),
    created_at               timestamptz NOT NULL DEFAULT now(),
    reviewed_by              uuid REFERENCES public.employees(id),
    reviewed_at              timestamptz,
    rejection_reason         text,
    ledger_entry_id          uuid REFERENCES public.ledger_entries(id),
    funding_mirror_expense_id uuid REFERENCES public.expenses(id),
    CONSTRAINT vendor_payment_requests_funding_consistency CHECK (
        (funding_type = 'bank' AND funding_bank_account_id IS NOT NULL AND funding_employee_id IS NULL)
        OR (funding_type = 'employee_custody' AND funding_employee_id IS NOT NULL AND funding_bank_account_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_vendor_payment_requests_status ON public.vendor_payment_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_payment_requests_requested_by ON public.vendor_payment_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_vendor_payment_requests_vendor ON public.vendor_payment_requests(vendor_id);

ALTER TABLE public.vendor_payment_requests ENABLE ROW LEVEL SECURITY;

-- Read-only from the client: the requester sees their own, approvers see all.
-- There is deliberately NO insert/update/delete policy — every write goes
-- through the SECURITY DEFINER functions below, which enforce the rules.
DROP POLICY IF EXISTS "Vendor payment requests viewable by requester or approver" ON public.vendor_payment_requests;
CREATE POLICY "Vendor payment requests viewable by requester or approver" ON public.vendor_payment_requests
    FOR SELECT TO authenticated
    USING (
        requested_by = public.current_employee_id()
        OR public.is_super_admin()
        OR COALESCE((SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()), false)
    );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vendor_payment_requests'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_payment_requests;
    END IF;
END $$;

-- ============================================================================
-- 3. Shared allocation validation. Same rules as record_vendor_payment
--    (20260915090000_fix_vendor_payment_float_rounding.sql): every allocated
--    document must belong to the vendor, be inside the caller's project
--    access, and not exceed its remaining due; the sum of allocations may not
--    exceed the payment amount. Bounds are compared rounded to cents.
--    Used both when the request is submitted (early feedback) and again when
--    it is approved (balances may have moved in between).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_vendor_payment_allocations(
    p_vendor_id   uuid,
    p_amount      numeric,
    p_allocations jsonb
) RETURNS void AS $$
DECLARE
    v_alloc            jsonb;
    v_total_allocated  numeric := 0;
    v_target_id        uuid;
    v_alloc_amount     numeric;
    v_target_type      text;
    v_doc_project_id   uuid;
    v_doc_party_id     uuid;
    v_doc_due          numeric;
    v_doc_paid         numeric;
BEGIN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        IF v_alloc_amount <= 0 THEN CONTINUE; END IF;

        v_total_allocated := v_total_allocated + v_alloc_amount;
        v_target_id := (v_alloc->>'target_id')::uuid;
        v_target_type := v_alloc->>'target_type';

        v_doc_party_id := NULL;

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

        IF ROUND(v_alloc_amount, 2) > ROUND(v_doc_due - COALESCE(v_doc_paid, 0), 2) THEN
            RAISE EXCEPTION 'Allocation of % exceeds remaining due % for document %',
                v_alloc_amount, (v_doc_due - COALESCE(v_doc_paid, 0)), v_target_id;
        END IF;
    END LOOP;

    IF ROUND(v_total_allocated, 2) > ROUND(p_amount, 2) THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed payment amount';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Internal helper — never callable directly from the client.
REVOKE ALL ON FUNCTION public.validate_vendor_payment_allocations(uuid, numeric, jsonb) FROM PUBLIC;

-- ============================================================================
-- 4. request_vendor_payment — submit a pending payment.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_vendor_payment(
    p_vendor_id                uuid,
    p_amount                   numeric,
    p_memo                     text,
    p_allocations              jsonb,
    p_project_id               uuid,
    p_funding_type             text,
    p_funding_bank_account_id  uuid DEFAULT NULL,
    p_funding_employee_id      uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_employee_id  uuid;
    v_has_flag     boolean;
    v_request_id   uuid;
    v_duplicate_id uuid;
BEGIN
    v_employee_id := public.current_employee_id();

    SELECT COALESCE(has_expense_funding_access, false) INTO v_has_flag
    FROM public.employees WHERE id = v_employee_id AND is_active IS NOT FALSE;

    -- Flagged employees who can also open the treasury payment screen, or a
    -- super admin. The flag alone (without the treasury page grant) is not
    -- enough: they could never have reached this screen to pick a vendor.
    IF NOT public.is_super_admin() AND NOT (COALESCE(v_has_flag, false) AND public.has_page_access('treasury')) THEN
        RAISE EXCEPTION 'Not authorized to request vendor payments';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = p_vendor_id) THEN
        RAISE EXCEPTION 'Vendor not found';
    END IF;

    IF p_funding_type = 'bank' THEN
        IF p_funding_bank_account_id IS NULL THEN RAISE EXCEPTION 'Bank account is required'; END IF;
        IF p_funding_employee_id IS NOT NULL THEN RAISE EXCEPTION 'Only one funding source can be chosen'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.bank_accounts WHERE id = p_funding_bank_account_id) THEN
            RAISE EXCEPTION 'Bank account not found';
        END IF;
    ELSIF p_funding_type = 'employee_custody' THEN
        IF p_funding_employee_id IS NULL THEN RAISE EXCEPTION 'Funding employee is required'; END IF;
        IF p_funding_bank_account_id IS NOT NULL THEN RAISE EXCEPTION 'Only one funding source can be chosen'; END IF;
        IF p_funding_employee_id = v_employee_id THEN
            RAISE EXCEPTION 'Cannot use yourself as the funding employee';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_funding_employee_id AND is_active IS NOT FALSE) THEN
            RAISE EXCEPTION 'Funding employee not found';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid funding type: %', p_funding_type;
    END IF;

    IF p_project_id IS NOT NULL
       AND NOT public.is_super_admin()
       AND NOT public.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized on project %', p_project_id;
    END IF;

    -- Duplicate-submission guard (double click / retry), same idea as
    -- 20260828120000_vendor_payment_duplicate_guard.sql.
    SELECT id INTO v_duplicate_id
    FROM public.vendor_payment_requests
    WHERE requested_by = v_employee_id
      AND vendor_id = p_vendor_id
      AND amount = p_amount
      AND project_id IS NOT DISTINCT FROM p_project_id
      AND funding_type = p_funding_type
      AND funding_bank_account_id IS NOT DISTINCT FROM p_funding_bank_account_id
      AND funding_employee_id IS NOT DISTINCT FROM p_funding_employee_id
      AND COALESCE(memo, '') = COALESCE(p_memo, '')
      AND created_at > now() - interval '3 minutes'
    LIMIT 1;

    IF v_duplicate_id IS NOT NULL THEN
        RAISE EXCEPTION 'يبدو أن نفس طلب الدفع (% لهذا المقاول) تم تقديمه للتو خلال آخر 3 دقائق — راجع الطلبات المعلقة قبل إعادة المحاولة لتفادي التكرار', p_amount;
    END IF;

    -- Early feedback: same document checks the approval will re-run.
    PERFORM public.validate_vendor_payment_allocations(p_vendor_id, p_amount, p_allocations);

    INSERT INTO public.vendor_payment_requests (
        vendor_id, project_id, amount, memo, allocations,
        funding_type, funding_bank_account_id, funding_employee_id, requested_by
    ) VALUES (
        p_vendor_id, p_project_id, p_amount, p_memo, COALESCE(p_allocations, '[]'::jsonb),
        p_funding_type, p_funding_bank_account_id, p_funding_employee_id, v_employee_id
    ) RETURNING id INTO v_request_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_employee_id, 'create', 'vendor_payment_request', v_request_id,
        jsonb_build_object(
            'vendor_id', p_vendor_id, 'amount', p_amount, 'project_id', p_project_id,
            'funding_type', p_funding_type, 'funding_bank_account_id', p_funding_bank_account_id,
            'funding_employee_id', p_funding_employee_id, 'allocations', p_allocations
        )
    );

    RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.request_vendor_payment(uuid, numeric, text, jsonb, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_vendor_payment(uuid, numeric, text, jsonb, uuid, text, uuid, uuid) TO authenticated;

-- ============================================================================
-- 5. approve_vendor_payment_request — the single choke point where the
--    payment actually lands on the vendor's account.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_vendor_payment_request(p_request_id uuid) RETURNS uuid AS $$
DECLARE
    v_approver_id     uuid;
    v_can_approve     boolean;
    v_req             record;
    v_ledger_id       uuid;
    v_mirror_id       uuid;
    v_alloc           jsonb;
    v_alloc_amount    numeric;
    v_target_type     text;
    v_target_id       uuid;
    v_vendor_name     text;
    v_funding_mirror_category_id CONSTANT uuid := '00000000-0000-0000-0000-000000000012';
    v_main_company_project_id    CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
    v_approver_id := public.current_employee_id();

    SELECT can_approve INTO v_can_approve FROM public.employees WHERE id = v_approver_id;
    IF NOT COALESCE(v_can_approve, false) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to approve vendor payments';
    END IF;

    SELECT * INTO v_req FROM public.vendor_payment_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;
    IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Payment request already processed'; END IF;

    -- Maker/checker: a non-super-admin approver may not approve their own request.
    IF v_req.requested_by = v_approver_id AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'You cannot approve your own payment request';
    END IF;

    -- Balances may have moved since submission (another payment, a credit
    -- settlement...). Re-check against the live remaining-due figures.
    PERFORM public.validate_vendor_payment_allocations(v_req.vendor_id, v_req.amount, v_req.allocations);

    SELECT name INTO v_vendor_name FROM public.vendors WHERE id = v_req.vendor_id;

    IF v_req.funding_type = 'bank' THEN
        INSERT INTO public.ledger_entries (
            entry_date, direction, amount, category, bank_account_id,
            counterparty_type, counterparty_id, project_id, memo, created_by
        ) VALUES (
            CURRENT_DATE, 'out', v_req.amount, 'vendor_payment', v_req.funding_bank_account_id,
            'vendor', v_req.vendor_id, v_req.project_id, v_req.memo, v_approver_id
        ) RETURNING id INTO v_ledger_id;

    ELSE -- 'employee_custody'
        -- Already-approved mirror expense on the funding employee's account so
        -- their custody balance drops by the amount, through the SAME FIFO as
        -- any other approved expense.
        INSERT INTO public.expenses (
            project_id, employee_id, category_id, expense_date, amount, notes,
            status, approved_by, approved_at, settled_amount, is_direct
        ) VALUES (
            v_main_company_project_id, v_req.funding_employee_id, v_funding_mirror_category_id, CURRENT_DATE, v_req.amount,
            'سداد للمقاول ' || COALESCE(v_vendor_name, '') || ' (طلب دفع رقم ' || p_request_id::text || ')',
            'approved', v_approver_id, now(), 0, false
        ) RETURNING id INTO v_mirror_id;

        -- Mirrors record_vendor_payment_from_expense: no bank, funded from the
        -- employee's (mirror) expense.
        INSERT INTO public.ledger_entries (
            entry_date, direction, amount, category, bank_account_id, employee_id,
            counterparty_type, counterparty_id, project_id, source_type, source_id, memo, created_by
        ) VALUES (
            CURRENT_DATE, 'out', v_req.amount, 'vendor_payment', NULL, v_req.funding_employee_id,
            'vendor', v_req.vendor_id, v_req.project_id, 'expense', v_mirror_id, v_req.memo, v_approver_id
        ) RETURNING id INTO v_ledger_id;

        PERFORM public.settle_employee_custody(v_req.funding_employee_id);

        INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
        VALUES (v_approver_id, 'create', 'expense', v_mirror_id,
            jsonb_build_object('funding_employee_id', v_req.funding_employee_id, 'amount', v_req.amount,
                               'funds_vendor_payment_request', p_request_id));
    END IF;

    -- Allocations: payment_allocations rows, or vendor_prior_claims.prior_paid_amount
    -- for a legacy prior claim (that target type is not tracked in payment_allocations).
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_req.allocations)
    LOOP
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        v_target_type  := v_alloc->>'target_type';
        v_target_id    := (v_alloc->>'target_id')::uuid;

        IF v_alloc_amount > 0 THEN
            IF v_target_type = 'prior_claim' THEN
                UPDATE public.vendor_prior_claims
                SET prior_paid_amount = prior_paid_amount + v_alloc_amount
                WHERE id = v_target_id AND vendor_id = v_req.vendor_id;

                INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
                VALUES (v_approver_id, 'update', 'vendor_prior_claim', v_target_id,
                    jsonb_build_object('vendor_id', v_req.vendor_id, 'amount', v_alloc_amount, 'payment_request_id', p_request_id));
            ELSE
                INSERT INTO public.payment_allocations (ledger_entry_id, target_type, target_id, allocated_amount)
                VALUES (v_ledger_id, v_target_type, v_target_id, v_alloc_amount);
            END IF;
        END IF;
    END LOOP;

    -- Receipts uploaded with the request follow the payment to its ledger row,
    -- so they show up on the vendor statement like any other vendor payment.
    INSERT INTO public.attachments (entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
    SELECT 'vendor_payment', v_ledger_id, r2_key, file_name, mime_type, size_bytes, uploaded_by
    FROM public.attachments
    WHERE entity_type = 'vendor_payment_request' AND entity_id = p_request_id;

    UPDATE public.vendor_payment_requests
    SET status = 'approved',
        reviewed_by = v_approver_id,
        reviewed_at = now(),
        ledger_entry_id = v_ledger_id,
        funding_mirror_expense_id = v_mirror_id
    WHERE id = p_request_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_approver_id, 'approve', 'vendor_payment_request', p_request_id,
        jsonb_build_object('status', 'approved', 'ledger_entry_id', v_ledger_id,
                           'funding_type', v_req.funding_type, 'amount', v_req.amount));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.approve_vendor_payment_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_vendor_payment_request(uuid) TO authenticated;

-- ============================================================================
-- 6. reject_vendor_payment_request — nothing was created on approval-side, so
--    a rejection is only a status change with a reason for the requester.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_vendor_payment_request(p_request_id uuid, p_reason text) RETURNS void AS $$
DECLARE
    v_approver_id uuid;
    v_can_approve boolean;
    v_status      text;
BEGIN
    v_approver_id := public.current_employee_id();

    SELECT can_approve INTO v_can_approve FROM public.employees WHERE id = v_approver_id;
    IF NOT COALESCE(v_can_approve, false) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to reject vendor payments';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A rejection reason is required';
    END IF;

    SELECT status INTO v_status FROM public.vendor_payment_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;
    IF v_status <> 'pending' THEN RAISE EXCEPTION 'Payment request already processed'; END IF;

    UPDATE public.vendor_payment_requests
    SET status = 'rejected', reviewed_by = v_approver_id, reviewed_at = now(), rejection_reason = btrim(p_reason)
    WHERE id = p_request_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_approver_id, 'reject', 'vendor_payment_request', p_request_id,
        jsonb_build_object('status', 'rejected', 'rejection_reason', btrim(p_reason)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.reject_vendor_payment_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_vendor_payment_request(uuid, text) TO authenticated;

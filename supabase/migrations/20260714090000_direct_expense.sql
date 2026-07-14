-- 20260714090000_direct_expense.sql
--
-- Admin-only "direct expense": create an expense that is already approved and
-- settled from a real bank account on the spot, bypassing the approval queue
-- and the employee custody balance entirely (no custody cash was advanced for it).
--
-- is_direct=true + settled_amount=amount at creation means:
--   - settle_employee_custody's FIFO loop (WHERE amount > settled_amount) skips it naturally.
--   - v_employee_custody_balance must exclude it from total_approved_expenses, otherwise
--     it would look like the employee spent custody cash they never received.
--   - record_vendor_payment_from_expense / pay_payslip_from_expense must refuse to reuse
--     it as a funding source — its cash is already spent.

-- 1. Flag column
ALTER TABLE public.expenses ADD COLUMN is_direct boolean NOT NULL DEFAULT false;

-- 2. Ledger category — add 'expense_direct'
ALTER TABLE public.ledger_entries DROP CONSTRAINT ledger_entries_category_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_category_check CHECK (
    category IN (
        'opening_balance',
        'bank_in',
        'bank_out',
        'custody_disbursement',
        'vendor_payment',
        'owner_payment',
        'deposit_collection',
        'deposit_principal_return',
        'interest',
        'deduction',
        'transfer_in',
        'transfer_out',
        'salary_payment',
        'loan_disbursement',
        'loan_repayment',
        'expense_direct'
    )
);

-- 3. v_employee_custody_balance — exclude direct expenses from the custody-approved total
CREATE OR REPLACE VIEW public.v_employee_custody_balance WITH (security_invoker = true) AS
SELECT
    e.id AS employee_id,
    e.full_name,
    COALESCE(disb.total_disbursed, 0) AS total_disbursed,
    COALESCE(exp.total_approved, 0) AS total_approved_expenses,
    COALESCE(setl.total_settled, 0) AS total_settled,
    COALESCE(disb.total_disbursed, 0) - COALESCE(exp.total_approved, 0) AS balance
FROM public.employees e
LEFT JOIN (
    SELECT employee_id, SUM(amount) AS total_disbursed
    FROM public.ledger_entries
    WHERE category = 'custody_disbursement' AND direction = 'in'
    GROUP BY employee_id
) disb ON e.id = disb.employee_id
LEFT JOIN (
    SELECT employee_id, SUM(amount) AS total_approved
    FROM public.expenses
    WHERE status = 'approved' AND is_direct = false
    GROUP BY employee_id
) exp ON e.id = exp.employee_id
LEFT JOIN (
    SELECT employee_id, SUM(amount) AS total_settled
    FROM public.custody_settlements
    GROUP BY employee_id
) setl ON e.id = setl.employee_id
WHERE e.has_custody_access = true
   OR disb.total_disbursed IS NOT NULL
   OR exp.total_approved IS NOT NULL;

-- 4. create_direct_expense — admin only, approves + settles from a bank account atomically
CREATE OR REPLACE FUNCTION public.create_direct_expense(
    p_employee_id     uuid,
    p_project_id      uuid,
    p_category_id     uuid,
    p_bank_account_id uuid,
    p_amount          numeric,
    p_expense_date    date,
    p_notes           text
) RETURNS uuid AS $$
DECLARE
    v_creator_id uuid;
    v_expense_id uuid;
    v_ledger_id  uuid;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to create a direct expense';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    IF p_bank_account_id IS NULL THEN
        RAISE EXCEPTION 'Bank account is required for a direct expense';
    END IF;

    IF p_employee_id IS NULL THEN
        RAISE EXCEPTION 'Employee is required for a direct expense';
    END IF;

    v_creator_id := public.current_employee_id();

    INSERT INTO public.expenses (
        project_id, employee_id, category_id, expense_date, amount, notes,
        status, approved_by, approved_at, settled_amount, is_direct
    ) VALUES (
        p_project_id, p_employee_id, p_category_id, p_expense_date, p_amount, p_notes,
        'approved', v_creator_id, now(), p_amount, true
    ) RETURNING id INTO v_expense_id;

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, project_id,
        employee_id, counterparty_type, counterparty_id, source_type, source_id, memo, created_by
    ) VALUES (
        p_expense_date, 'out', p_amount, 'expense_direct', p_bank_account_id, p_project_id,
        p_employee_id, 'employee', p_employee_id, 'expense', v_expense_id, p_notes, v_creator_id
    ) RETURNING id INTO v_ledger_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_creator_id, 'create', 'direct_expense', v_expense_id,
        jsonb_build_object(
            'employee_id', p_employee_id, 'amount', p_amount,
            'bank_account_id', p_bank_account_id, 'ledger_entry_id', v_ledger_id
        )
    );

    RETURN v_expense_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Guard record_vendor_payment_from_expense against funding from an already-settled direct expense
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
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury') THEN
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

-- 6. Guard pay_payslip_from_expense against funding from an already-settled direct expense
CREATE OR REPLACE FUNCTION public.pay_payslip_from_expense(
    p_payslip_id uuid,
    p_funding_employee_id uuid,
    p_expense_id uuid,
    p_amount numeric,
    p_date date,
    p_memo text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_creator_id uuid;
    v_payslip record;
    v_paid_so_far numeric(18,2);
    v_remaining numeric(18,2);
    v_expense_employee_id uuid;
    v_expense_status text;
    v_expense_amount numeric(18,2);
    v_expense_paid numeric(18,2);
    v_expense_available numeric(18,2);
    v_expense_is_direct boolean;
    v_ledger_id uuid;
    v_unpaid_count int;
BEGIN
    IF NOT public.has_page_access('salary') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    v_creator_id := public.current_employee_id();

    SELECT * INTO v_payslip FROM public.payslips WHERE id = p_payslip_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payslip not found';
    END IF;
    IF v_payslip.status <> 'approved' THEN
        RAISE EXCEPTION 'Only an approved payslip can be paid';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_paid_so_far FROM public.payslip_payments WHERE payslip_id = p_payslip_id;
    v_remaining := v_payslip.net_amount - v_paid_so_far;
    IF p_amount > v_remaining + 0.01 THEN
        RAISE EXCEPTION 'Amount % exceeds the remaining balance %', p_amount, v_remaining;
    END IF;

    SELECT employee_id, status, amount, is_direct INTO v_expense_employee_id, v_expense_status, v_expense_amount, v_expense_is_direct
    FROM public.expenses WHERE id = p_expense_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense % not found', p_expense_id;
    END IF;
    IF v_expense_employee_id IS DISTINCT FROM p_funding_employee_id THEN
        RAISE EXCEPTION 'Expense does not belong to the selected employee';
    END IF;
    IF v_expense_status != 'approved' THEN
        RAISE EXCEPTION 'Expense must be approved to fund a salary payment';
    END IF;
    IF v_expense_is_direct THEN
        RAISE EXCEPTION 'A direct expense is already fully settled and cannot fund a salary payment';
    END IF;

    SELECT paid_amount INTO v_expense_paid FROM public.v_expense_vendor_paid WHERE expense_id = p_expense_id;
    v_expense_available := v_expense_amount - COALESCE(v_expense_paid, 0);
    IF p_amount > v_expense_available THEN
        RAISE EXCEPTION 'Amount % exceeds the expense remaining unused balance %', p_amount, v_expense_available;
    END IF;

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, employee_id, memo, created_by, counterparty_type, counterparty_id, source_type, source_id
    ) VALUES (
        p_date, 'out', p_amount, 'salary_payment', v_payslip.employee_id, p_memo, v_creator_id, 'employee', v_payslip.employee_id, 'expense', p_expense_id
    ) RETURNING id INTO v_ledger_id;

    INSERT INTO public.payslip_payments (payslip_id, ledger_entry_id, funding_source, expense_id, amount, payment_date)
    VALUES (p_payslip_id, v_ledger_id, 'expense', p_expense_id, p_amount, p_date);

    IF (v_paid_so_far + p_amount) >= (v_payslip.net_amount - 0.01) THEN
        UPDATE public.payslips SET status = 'paid', paid_at = now() WHERE id = p_payslip_id;

        SELECT count(*) INTO v_unpaid_count FROM public.payslips WHERE payroll_run_id = v_payslip.payroll_run_id AND status <> 'paid';
        IF v_unpaid_count = 0 THEN
            UPDATE public.payroll_runs SET status = 'paid' WHERE id = v_payslip.payroll_run_id;
        END IF;
    END IF;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_creator_id, 'update', 'payslip_payment', v_ledger_id, jsonb_build_object('payslip_id', p_payslip_id, 'amount', p_amount, 'funding_source', 'expense', 'expense_id', p_expense_id));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

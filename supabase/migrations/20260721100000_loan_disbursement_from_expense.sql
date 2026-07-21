-- 20260721100000_loan_disbursement_from_expense.sql
--
-- Allow a salary advance (employee_loans) to be funded from an employee's
-- custody instead of a bank account — implemented as a real expense on the
-- custody holder's account, going through the exact same pending -> approved
-- expense workflow as any other expense (approve_expense/reject_expense),
-- rather than a special-cased "pick an existing balance" mechanism.
--
-- Why an expense and not a direct draw against custody: an approved expense's
-- project_id is what actually drives project cost (v_project_financial_position),
-- and the borrowing employee's salary cost is independently driven by their own
-- payslip_project_allocations. Funding a loan from an *already project-tagged*
-- expense would silently mix an unrelated employee's advance into that
-- project's cost. Booking the loan's own funding expense to the main-company
-- project (a loan has no project of its own) avoids that entirely, while
-- still going through custody/approval like any other spend.
--
-- Lifecycle: request_loan_from_custody creates the expense (pending) + the
-- loan (status='pending', installments pre-built but inert — nothing reads
-- them until the loan is 'active') in one step. approve_expense, on seeing a
-- pending loan pointing at the expense it just approved, builds the
-- disbursement ledger entry and flips the loan to 'active'. reject_expense
-- cancels the loan the same way cancel_loan does.

-- ============================================================================
-- 1. employee_loans: funding source columns + 'pending' status. Written to
--    be safe to re-run: an earlier partial run of this file (an early draft
--    of the feature) already added funding_source/funding_employee_id/
--    expense_id on some environments, so every step here is idempotent.
-- ============================================================================

ALTER TABLE public.employee_loans DROP CONSTRAINT IF EXISTS employee_loans_status_check;
ALTER TABLE public.employee_loans ADD CONSTRAINT employee_loans_status_check
    CHECK (status IN ('pending', 'active', 'completed', 'cancelled'));

ALTER TABLE public.employee_loans
    ADD COLUMN IF NOT EXISTS funding_source text NOT NULL DEFAULT 'bank',
    ADD COLUMN IF NOT EXISTS funding_employee_id uuid REFERENCES public.employees(id),
    ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.expenses(id);

ALTER TABLE public.employee_loans DROP CONSTRAINT IF EXISTS employee_loans_funding_source_check;
ALTER TABLE public.employee_loans ADD CONSTRAINT employee_loans_funding_source_check
    CHECK (funding_source IN ('bank', 'expense'));

ALTER TABLE public.employee_loans DROP CONSTRAINT IF EXISTS employee_loans_funding_consistency;
ALTER TABLE public.employee_loans ADD CONSTRAINT employee_loans_funding_consistency CHECK (
    (funding_source = 'bank' AND bank_account_id IS NOT NULL AND expense_id IS NULL)
    OR
    (funding_source = 'expense' AND expense_id IS NOT NULL AND funding_employee_id IS NOT NULL AND bank_account_id IS NULL)
);

-- ============================================================================
-- 2. Broaden v_expense_vendor_paid so an expense that has funded a loan shows
--    zero remaining balance to the vendor/salary "pay from expense" pickers —
--    otherwise the same expense could be spent twice.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_expense_vendor_paid WITH (security_invoker = true) AS
SELECT
    e.id AS expense_id,
    COALESCE(SUM(le.amount), 0) AS paid_amount
FROM public.expenses e
LEFT JOIN public.ledger_entries le
    ON le.source_type = 'expense'
   AND le.source_id = e.id
   AND le.category IN ('vendor_payment', 'salary_payment', 'loan_disbursement')
GROUP BY e.id;

-- ============================================================================
-- 3. Fixed "سلفة من الراتب" (salary advance) expense category — every
--    custody-funded loan books to this one category, on the main-company
--    project. Pinned to a literal id (like MAIN_COMPANY_PROJECT_ID) so the
--    RPC below never needs a name lookup, and scoped to main_company so it
--    doesn't clutter category pickers for project-specific expenses.
-- ============================================================================

INSERT INTO public.expense_categories (id, name, is_active)
VALUES ('00000000-0000-0000-0000-000000000010', 'سلفة من الراتب', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.expense_category_scopes (category_id, scope)
SELECT '00000000-0000-0000-0000-000000000010', 'main_company'
WHERE NOT EXISTS (
    SELECT 1 FROM public.expense_category_scopes
    WHERE category_id = '00000000-0000-0000-0000-000000000010' AND scope = 'main_company'
);

-- ============================================================================
-- 4. request_loan_from_custody — creates the funding expense (pending, on
--    the main-company project, fixed "سلفة من الراتب" category) and the loan
--    (pending, installments built but inert) in one step.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_loan_from_custody(
    p_employee_id uuid,          -- loan recipient (borrower)
    p_funding_employee_id uuid,  -- custody holder whose account absorbs the expense
    p_amount numeric,
    p_date date,
    p_repayment_type text,
    p_installment_months int DEFAULT NULL,
    p_custom_schedule jsonb DEFAULT NULL,
    p_memo text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_creator_id uuid;
    v_expense_id uuid;
    v_loan_id uuid;
    v_i int;
    v_base numeric(18,2);
    v_last numeric(18,2);
    v_item jsonb;
    v_schedule_total numeric(18,2) := 0;
    v_due_date date;
    v_main_company_project_id CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
    v_salary_advance_category_id CONSTANT uuid := '00000000-0000-0000-0000-000000000010';
BEGIN
    IF NOT public.has_page_access('salary') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    IF p_repayment_type NOT IN ('next_salary_full', 'equal_installments', 'custom_schedule') THEN
        RAISE EXCEPTION 'Invalid repayment type %', p_repayment_type;
    END IF;
    IF p_repayment_type = 'equal_installments' AND (p_installment_months IS NULL OR p_installment_months <= 0) THEN
        RAISE EXCEPTION 'installment_months is required for equal_installments';
    END IF;
    IF p_repayment_type = 'custom_schedule' THEN
        IF p_custom_schedule IS NULL OR jsonb_array_length(p_custom_schedule) = 0 THEN
            RAISE EXCEPTION 'custom_schedule is required for custom_schedule repayment type';
        END IF;
        SELECT COALESCE(SUM((item->>'amount')::numeric), 0) INTO v_schedule_total
        FROM jsonb_array_elements(p_custom_schedule) AS item;
        IF v_schedule_total <> p_amount THEN
            RAISE EXCEPTION 'Custom schedule total % does not match loan amount %', v_schedule_total, p_amount;
        END IF;
    END IF;

    v_creator_id := public.current_employee_id();

    INSERT INTO public.expenses (
        project_id, employee_id, category_id, expense_date, amount, notes, status, is_direct
    ) VALUES (
        v_main_company_project_id, p_funding_employee_id, v_salary_advance_category_id, p_date, p_amount, p_memo, 'pending', false
    ) RETURNING id INTO v_expense_id;

    INSERT INTO public.employee_loans (
        employee_id, principal_amount, disbursed_date, repayment_type, installment_months,
        status, funding_source, funding_employee_id, expense_id, notes, created_by
    ) VALUES (
        p_employee_id, p_amount, p_date, p_repayment_type, p_installment_months,
        'pending', 'expense', p_funding_employee_id, v_expense_id, p_memo, v_creator_id
    ) RETURNING id INTO v_loan_id;

    IF p_repayment_type = 'next_salary_full' THEN
        INSERT INTO public.loan_installments (loan_id, due_date, scheduled_amount, sort_order)
        VALUES (v_loan_id, p_date, p_amount, 1);

    ELSIF p_repayment_type = 'equal_installments' THEN
        v_base := floor((p_amount / p_installment_months) * 100) / 100;
        v_last := p_amount - v_base * (p_installment_months - 1);
        FOR v_i IN 1..p_installment_months LOOP
            v_due_date := (date_trunc('month', p_date) + (v_i || ' months')::interval)::date;
            INSERT INTO public.loan_installments (loan_id, due_date, scheduled_amount, sort_order)
            VALUES (v_loan_id, v_due_date, CASE WHEN v_i = p_installment_months THEN v_last ELSE v_base END, v_i);
        END LOOP;

    ELSE -- custom_schedule
        v_i := 0;
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_custom_schedule) LOOP
            v_i := v_i + 1;
            INSERT INTO public.loan_installments (loan_id, due_date, scheduled_amount, sort_order)
            VALUES (v_loan_id, (v_item->>'due_date')::date, (v_item->>'amount')::numeric, v_i);
        END LOOP;
    END IF;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_creator_id, 'create', 'employee_loan', v_loan_id,
        jsonb_build_object('employee_id', p_employee_id, 'amount', p_amount, 'repayment_type', p_repayment_type, 'funding_source', 'expense', 'expense_id', v_expense_id)
    );

    RETURN v_loan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. approve_expense — on approving an expense that a pending loan points
--    at, build its disbursement ledger entry and flip it to 'active'. Same
--    signature/base body as the current version (0020_phase12_owner_custody.sql).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_expense(p_expense_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id    uuid;
    v_target_employee uuid;
    v_status         text;
    v_can_approve    boolean;
    v_loan           record;
    v_ledger_id      uuid;
BEGIN
    v_employee_id := public.current_employee_id();

    SELECT can_approve INTO v_can_approve FROM public.employees WHERE id = v_employee_id;
    IF NOT v_can_approve AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to approve expenses';
    END IF;

    SELECT employee_id, status INTO v_target_employee, v_status
    FROM public.expenses WHERE id = p_expense_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
    IF v_status != 'pending' THEN RAISE EXCEPTION 'Expense already processed'; END IF;

    UPDATE public.expenses
    SET status = 'approved', approved_by = v_employee_id, approved_at = now()
    WHERE id = p_expense_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_employee_id, 'approve', 'expense', p_expense_id, jsonb_build_object('status', 'approved'));

    -- Only settle employee custody when the expense belongs to an employee
    IF v_target_employee IS NOT NULL THEN
        PERFORM public.settle_employee_custody(v_target_employee);
    END IF;

    SELECT * INTO v_loan FROM public.employee_loans WHERE expense_id = p_expense_id AND status = 'pending' FOR UPDATE;
    IF FOUND THEN
        INSERT INTO public.ledger_entries (
            entry_date, direction, amount, category, employee_id, memo, created_by, counterparty_type, counterparty_id, source_type, source_id
        ) VALUES (
            v_loan.disbursed_date, 'out', v_loan.principal_amount, 'loan_disbursement', v_loan.employee_id, v_loan.notes, v_employee_id, 'employee', v_loan.employee_id, 'expense', p_expense_id
        ) RETURNING id INTO v_ledger_id;

        UPDATE public.employee_loans SET status = 'active', disbursement_ledger_entry_id = v_ledger_id WHERE id = v_loan.id;

        INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
        VALUES (v_employee_id, 'update', 'employee_loan', v_loan.id, jsonb_build_object('status', 'active', 'expense_id', p_expense_id));
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. reject_expense — rejecting an expense that a pending loan points at
--    cancels the loan too (nothing was ever disbursed, so this is a clean
--    cancel, same cleanup as cancel_loan).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_expense(p_expense_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id uuid;
    v_status text;
    v_can_approve boolean;
    v_loan_id uuid;
BEGIN
    v_employee_id := public.current_employee_id();

    SELECT can_approve INTO v_can_approve FROM public.employees WHERE id = v_employee_id;
    IF NOT v_can_approve AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to reject expenses';
    END IF;

    SELECT status INTO v_status FROM public.expenses WHERE id = p_expense_id;
    IF v_status != 'pending' THEN RAISE EXCEPTION 'Expense already processed'; END IF;

    UPDATE public.expenses
    SET status = 'rejected', approved_by = v_employee_id, approved_at = now()
    WHERE id = p_expense_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_employee_id, 'reject', 'expense', p_expense_id, jsonb_build_object('status', 'rejected'));

    SELECT id INTO v_loan_id FROM public.employee_loans WHERE expense_id = p_expense_id AND status = 'pending' FOR UPDATE;
    IF FOUND THEN
        UPDATE public.employee_loans SET status = 'cancelled' WHERE id = v_loan_id;
        UPDATE public.loan_installments SET status = 'skipped' WHERE loan_id = v_loan_id AND status = 'pending';

        INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
        VALUES (v_employee_id, 'update', 'employee_loan', v_loan_id, jsonb_build_object('status', 'cancelled', 'reason', 'funding_expense_rejected'));
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

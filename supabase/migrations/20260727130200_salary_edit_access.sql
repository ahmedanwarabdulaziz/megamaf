-- 20260727130200_salary_edit_access.sql
--
-- Salary write policies + RPCs already checked has_page_access('salary')
-- with no level distinction. Require 'edit' level now that view/edit
-- levels exist, so a view-only grant on the salary page can no longer
-- run payroll/loan mutations.
--
-- (RPC bodies below are copied verbatim from 20260713100000/20260713100100/
-- 20260714090000/20260721100000, with only the has_page_access() check
-- updated to the 2-arg 'edit' form — CREATE OR REPLACE FUNCTION re-declares
-- the same function, so this is safe to run after all of those.)

CREATE OR REPLACE FUNCTION public.generate_payroll_run(
    p_year int,
    p_month int
) RETURNS uuid AS $$
DECLARE
    v_run_id uuid;
    v_creator_id uuid;
    v_period_start date;
    v_period_end date;
    v_emp record;
BEGIN
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_month < 1 OR p_month > 12 THEN
        RAISE EXCEPTION 'Invalid month %', p_month;
    END IF;

    IF EXISTS (SELECT 1 FROM public.payroll_runs WHERE period_year = p_year AND period_month = p_month) THEN
        RAISE EXCEPTION 'A payroll run already exists for %-%', p_year, p_month;
    END IF;

    v_creator_id := public.current_employee_id();
    v_period_start := make_date(p_year, p_month, 1);
    v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;

    INSERT INTO public.payroll_runs (period_year, period_month, status, created_by)
    VALUES (p_year, p_month, 'draft', v_creator_id)
    RETURNING id INTO v_run_id;

    FOR v_emp IN
        SELECT e.id AS employee_id
        FROM public.employees e
        JOIN public.employee_salaries s ON s.employee_id = e.id
        WHERE e.is_active = true
          AND s.effective_from <= v_period_end
          AND (s.effective_to IS NULL OR s.effective_to >= v_period_start)
    LOOP
        PERFORM public.create_payslip_for_employee(v_run_id, v_emp.employee_id, p_year, p_month);
    END LOOP;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_creator_id, 'create', 'payroll_run', v_run_id, jsonb_build_object('period_year', p_year, 'period_month', p_month));

    RETURN v_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.add_employee_to_payroll_run(
    p_run_id uuid,
    p_employee_id uuid
) RETURNS uuid AS $$
DECLARE
    v_creator_id uuid;
    v_status text;
    v_period_year int;
    v_period_month int;
    v_payslip_id uuid;
BEGIN
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_creator_id := public.current_employee_id();

    SELECT status, period_year, period_month INTO v_status, v_period_year, v_period_month
    FROM public.payroll_runs WHERE id = p_run_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run not found';
    END IF;
    IF v_status <> 'draft' THEN
        RAISE EXCEPTION 'Employees can only be added while the run is still a draft';
    END IF;

    IF EXISTS (SELECT 1 FROM public.payslips WHERE payroll_run_id = p_run_id AND employee_id = p_employee_id) THEN
        RAISE EXCEPTION 'This employee already has a payslip in this run';
    END IF;

    v_payslip_id := public.create_payslip_for_employee(p_run_id, p_employee_id, v_period_year, v_period_month);

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_creator_id, 'create', 'payslip', v_payslip_id, jsonb_build_object('payroll_run_id', p_run_id, 'employee_id', p_employee_id));

    RETURN v_payslip_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.remove_payslip_from_run(p_payslip_id uuid) RETURNS void AS $$
DECLARE
    v_creator_id uuid;
    v_status text;
    v_run_id uuid;
BEGIN
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_creator_id := public.current_employee_id();

    SELECT status, payroll_run_id INTO v_status, v_run_id FROM public.payslips WHERE id = p_payslip_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payslip not found';
    END IF;
    IF v_status <> 'draft' THEN
        RAISE EXCEPTION 'Only a draft payslip can be removed from a run';
    END IF;

    DELETE FROM public.payslips WHERE id = p_payslip_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_creator_id, 'delete', 'payslip', p_payslip_id, jsonb_build_object('payroll_run_id', v_run_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.approve_payroll_run(p_run_id uuid) RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_status text;
    v_period_year int;
    v_period_month int;
    v_period_end date;
    v_payslip record;
    v_alloc_sum numeric(18,2);
    v_net_before_loan numeric(18,2);
    v_remaining_capacity numeric(18,2);
    v_total_loan_repaid numeric(18,2);
    v_installment record;
    v_take numeric(18,2);
    v_loan_ledger_id uuid;
BEGIN
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_emp_id := public.current_employee_id();

    SELECT status, period_year, period_month INTO v_status, v_period_year, v_period_month
    FROM public.payroll_runs WHERE id = p_run_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run not found';
    END IF;
    IF v_status <> 'draft' THEN
        RAISE EXCEPTION 'Only a draft payroll run can be approved';
    END IF;

    v_period_end := (make_date(v_period_year, v_period_month, 1) + interval '1 month' - interval '1 day')::date;

    -- Every payslip's project split must sum to its base salary before this
    -- run can be approved — it's what feeds project cost, so an under/over
    -- allocated payslip would silently misstate project costs.
    FOR v_payslip IN
        SELECT p.id, p.base_amount, e.full_name
        FROM public.payslips p
        JOIN public.employees e ON e.id = p.employee_id
        WHERE p.payroll_run_id = p_run_id
    LOOP
        SELECT COALESCE(SUM(allocated_amount), 0) INTO v_alloc_sum
        FROM public.payslip_project_allocations
        WHERE payslip_id = v_payslip.id;

        IF abs(v_alloc_sum - v_payslip.base_amount) > 0.01 THEN
            RAISE EXCEPTION 'توزيع المشاريع لـ % (%) لا يساوي الراتب الأساسي (%)', v_payslip.full_name, v_alloc_sum, v_payslip.base_amount;
        END IF;
    END LOOP;

    FOR v_payslip IN
        SELECT id, employee_id, gross_amount, deductions_total
        FROM public.payslips
        WHERE payroll_run_id = p_run_id
    LOOP
        v_net_before_loan := v_payslip.gross_amount - v_payslip.deductions_total;
        v_remaining_capacity := GREATEST(v_net_before_loan, 0);
        v_total_loan_repaid := 0;

        FOR v_installment IN
            SELECT li.*
            FROM public.loan_installments li
            JOIN public.employee_loans el ON el.id = li.loan_id
            WHERE el.employee_id = v_payslip.employee_id
              AND el.status = 'active'
              AND li.status = 'pending'
              AND li.due_date <= v_period_end
            ORDER BY li.due_date, li.sort_order
            FOR UPDATE OF li
        LOOP
            EXIT WHEN v_remaining_capacity <= 0;
            v_take := LEAST(v_installment.scheduled_amount - v_installment.paid_amount, v_remaining_capacity);
            IF v_take > 0 THEN
                INSERT INTO public.ledger_entries (
                    entry_date, direction, amount, category, employee_id, memo, created_by, counterparty_type, counterparty_id, source_type, source_id
                ) VALUES (
                    CURRENT_DATE, 'out', v_take, 'loan_repayment', v_payslip.employee_id, 'Loan installment deducted from salary', v_emp_id, 'employee', v_payslip.employee_id, 'loan_installment', v_installment.id
                ) RETURNING id INTO v_loan_ledger_id;

                INSERT INTO public.loan_repayments (loan_id, installment_id, payslip_id, ledger_entry_id, amount, repayment_date)
                VALUES (v_installment.loan_id, v_installment.id, v_payslip.id, v_loan_ledger_id, v_take, CURRENT_DATE);

                UPDATE public.loan_installments
                SET paid_amount = paid_amount + v_take,
                    status = CASE WHEN paid_amount + v_take >= scheduled_amount THEN 'paid' ELSE 'pending' END
                WHERE id = v_installment.id;

                IF NOT EXISTS (SELECT 1 FROM public.loan_installments WHERE loan_id = v_installment.loan_id AND status = 'pending') THEN
                    UPDATE public.employee_loans SET status = 'completed' WHERE id = v_installment.loan_id;
                END IF;

                v_total_loan_repaid := v_total_loan_repaid + v_take;
                v_remaining_capacity := v_remaining_capacity - v_take;
            END IF;
        END LOOP;

        UPDATE public.payslips
        SET loan_deduction_total = v_total_loan_repaid,
            net_amount = v_net_before_loan - v_total_loan_repaid,
            status = 'approved'
        WHERE id = v_payslip.id;
    END LOOP;

    UPDATE public.payroll_runs SET status = 'approved', approved_by = v_emp_id, approved_at = now() WHERE id = p_run_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'approve', 'payroll_run', p_run_id, jsonb_build_object('status', 'approved'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.pay_payslip_from_bank(
    p_payslip_id uuid,
    p_bank_account_id uuid,
    p_amount numeric,
    p_date date,
    p_memo text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_creator_id uuid;
    v_payslip record;
    v_paid_so_far numeric(18,2);
    v_remaining numeric(18,2);
    v_ledger_id uuid;
    v_unpaid_count int;
BEGIN
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
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

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, employee_id, memo, created_by, counterparty_type, counterparty_id, source_type, source_id
    ) VALUES (
        p_date, 'out', p_amount, 'salary_payment', p_bank_account_id, v_payslip.employee_id, p_memo, v_creator_id, 'employee', v_payslip.employee_id, 'payslip', p_payslip_id
    ) RETURNING id INTO v_ledger_id;

    INSERT INTO public.payslip_payments (payslip_id, ledger_entry_id, funding_source, amount, payment_date)
    VALUES (p_payslip_id, v_ledger_id, 'bank', p_amount, p_date);

    IF (v_paid_so_far + p_amount) >= (v_payslip.net_amount - 0.01) THEN
        UPDATE public.payslips SET status = 'paid', paid_at = now() WHERE id = p_payslip_id;

        SELECT count(*) INTO v_unpaid_count FROM public.payslips WHERE payroll_run_id = v_payslip.payroll_run_id AND status <> 'paid';
        IF v_unpaid_count = 0 THEN
            UPDATE public.payroll_runs SET status = 'paid' WHERE id = v_payslip.payroll_run_id;
        END IF;
    END IF;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_creator_id, 'update', 'payslip_payment', v_ledger_id, jsonb_build_object('payslip_id', p_payslip_id, 'amount', p_amount, 'funding_source', 'bank'));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Latest definition is in 20260714090000_direct_expense.sql (adds the
-- is_direct guard) — copied from there, not from 20260713100100.
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
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
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

CREATE OR REPLACE FUNCTION public.disburse_loan(
    p_employee_id uuid,
    p_bank_account_id uuid,
    p_amount numeric,
    p_date date,
    p_repayment_type text,
    p_installment_months int DEFAULT NULL,
    p_custom_schedule jsonb DEFAULT NULL,
    p_memo text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_creator_id uuid;
    v_loan_id uuid;
    v_out_id uuid;
    v_i int;
    v_base numeric(18,2);
    v_last numeric(18,2);
    v_item jsonb;
    v_schedule_total numeric(18,2) := 0;
    v_due_date date;
BEGIN
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
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

    INSERT INTO public.employee_loans (
        employee_id, principal_amount, disbursed_date, repayment_type, installment_months, bank_account_id, notes, created_by
    ) VALUES (
        p_employee_id, p_amount, p_date, p_repayment_type, p_installment_months, p_bank_account_id, p_memo, v_creator_id
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

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, memo, created_by, counterparty_type, counterparty_id, source_type, source_id
    ) VALUES (
        p_date, 'out', p_amount, 'loan_disbursement', p_bank_account_id, p_memo, v_creator_id, 'employee', p_employee_id, 'loan', v_loan_id
    ) RETURNING id INTO v_out_id;

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, employee_id, memo, created_by, counterparty_type, counterparty_id, source_type, source_id
    ) VALUES (
        p_date, 'in', p_amount, 'loan_disbursement', p_employee_id, p_memo, v_creator_id, 'bank', p_bank_account_id, 'loan', v_loan_id
    );

    UPDATE public.employee_loans SET disbursement_ledger_entry_id = v_out_id WHERE id = v_loan_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_creator_id, 'create', 'employee_loan', v_loan_id, jsonb_build_object('employee_id', p_employee_id, 'amount', p_amount, 'repayment_type', p_repayment_type));

    RETURN v_loan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.cancel_loan(p_loan_id uuid) RETURNS void AS $$
DECLARE
    v_creator_id uuid;
    v_status text;
    v_repayment_count int;
BEGIN
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_creator_id := public.current_employee_id();

    SELECT status INTO v_status FROM public.employee_loans WHERE id = p_loan_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan not found';
    END IF;
    IF v_status <> 'active' THEN
        RAISE EXCEPTION 'Only an active loan can be cancelled';
    END IF;

    SELECT count(*) INTO v_repayment_count FROM public.loan_repayments WHERE loan_id = p_loan_id;
    IF v_repayment_count > 0 THEN
        RAISE EXCEPTION 'Cannot cancel a loan that already has repayments';
    END IF;

    UPDATE public.employee_loans SET status = 'cancelled' WHERE id = p_loan_id;
    UPDATE public.loan_installments SET status = 'skipped' WHERE loan_id = p_loan_id AND status = 'pending';

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_creator_id, 'update', 'employee_loan', p_loan_id, jsonb_build_object('status', 'cancelled'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
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

-- ── Table write policies (originally in 20260713100000_add_salary_payroll_schema.sql) ──
-- Only the "modifiable"/write policies change; "select scoped" policies keep
-- calling the 1-arg has_page_access() (view-or-above), unchanged.

-- Using DROP + CREATE instead of ALTER POLICY: this repo's migrations/
-- folder does not necessarily match what has actually been applied to the
-- live database, so ALTER POLICY's "policy must already exist" requirement
-- is unsafe to rely on. DROP POLICY IF EXISTS + CREATE POLICY works whether
-- or not the policy currently exists.

DROP POLICY IF EXISTS "Employee salaries modifiable by salary access" ON public.employee_salaries;
CREATE POLICY "Employee salaries modifiable by salary access" ON public.employee_salaries
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('salary', 'edit'));

DROP POLICY IF EXISTS "Payroll runs modifiable by salary access" ON public.payroll_runs;
CREATE POLICY "Payroll runs modifiable by salary access" ON public.payroll_runs
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('salary', 'edit'));

DROP POLICY IF EXISTS "Payslips modifiable by salary access" ON public.payslips;
CREATE POLICY "Payslips modifiable by salary access" ON public.payslips
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('salary', 'edit'));

DROP POLICY IF EXISTS "Payslip components modifiable by salary access" ON public.payslip_components;
CREATE POLICY "Payslip components modifiable by salary access" ON public.payslip_components
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('salary', 'edit'));

DROP POLICY IF EXISTS "Payslip project allocations modifiable by salary access" ON public.payslip_project_allocations;
CREATE POLICY "Payslip project allocations modifiable by salary access" ON public.payslip_project_allocations
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('salary', 'edit'));

DROP POLICY IF EXISTS "Payslip payments modifiable by salary access" ON public.payslip_payments;
CREATE POLICY "Payslip payments modifiable by salary access" ON public.payslip_payments
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('salary', 'edit'));

DROP POLICY IF EXISTS "Employee loans modifiable by salary access" ON public.employee_loans;
CREATE POLICY "Employee loans modifiable by salary access" ON public.employee_loans
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('salary', 'edit'));

DROP POLICY IF EXISTS "Loan installments modifiable by salary access" ON public.loan_installments;
CREATE POLICY "Loan installments modifiable by salary access" ON public.loan_installments
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('salary', 'edit'));

DROP POLICY IF EXISTS "Loan repayments modifiable by salary access" ON public.loan_repayments;
CREATE POLICY "Loan repayments modifiable by salary access" ON public.loan_repayments
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('salary', 'edit'));


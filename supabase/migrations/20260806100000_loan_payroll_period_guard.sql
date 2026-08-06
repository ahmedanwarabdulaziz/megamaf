-- Prevent loan requests dated inside a payroll month that's already
-- approved/paid, or inside an earlier month that was skipped and never
-- processed. The "earliest open payroll date" is:
--   - the 1st of the month right after the most recent approved/paid run, or
--   - the 1st of the most recent run's month if that run is still 'draft', or
--   - NULL (no restriction) if no payroll run has ever been created.
CREATE OR REPLACE FUNCTION public.get_earliest_open_payroll_date()
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_latest record;
BEGIN
    IF NOT public.has_page_access('salary') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT period_year, period_month, status INTO v_latest
    FROM public.payroll_runs
    ORDER BY period_year DESC, period_month DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_latest.status IN ('approved', 'paid') THEN
        RETURN (make_date(v_latest.period_year, v_latest.period_month, 1) + INTERVAL '1 month')::date;
    ELSE
        RETURN make_date(v_latest.period_year, v_latest.period_month, 1);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_loan_from_bank(
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
    v_expense_id uuid;
    v_loan_id uuid;
    v_i int;
    v_base numeric(18,2);
    v_last numeric(18,2);
    v_item jsonb;
    v_schedule_total numeric(18,2) := 0;
    v_due_date date;
    v_earliest_open date;
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

    v_earliest_open := public.get_earliest_open_payroll_date();
    IF v_earliest_open IS NOT NULL AND p_date < v_earliest_open THEN
        RAISE EXCEPTION 'لا يمكن تسجيل سلفة بتاريخ % لأن رواتب هذا الشهر معتمدة أو منتهية. أقرب تاريخ متاح هو %', p_date, v_earliest_open;
    END IF;

    v_creator_id := public.current_employee_id();

    INSERT INTO public.expenses (
        project_id, employee_id, category_id, expense_date, amount, notes, status, is_direct
    ) VALUES (
        v_main_company_project_id, p_employee_id, v_salary_advance_category_id, p_date, p_amount, p_memo, 'pending', true
    ) RETURNING id INTO v_expense_id;

    INSERT INTO public.employee_loans (
        employee_id, principal_amount, disbursed_date, repayment_type, installment_months,
        status, funding_source, bank_account_id, expense_id, notes, created_by
    ) VALUES (
        p_employee_id, p_amount, p_date, p_repayment_type, p_installment_months,
        'pending', 'bank', p_bank_account_id, v_expense_id, p_memo, v_creator_id
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
        jsonb_build_object('employee_id', p_employee_id, 'amount', p_amount, 'repayment_type', p_repayment_type, 'funding_source', 'bank', 'bank_account_id', p_bank_account_id, 'expense_id', v_expense_id)
    );

    RETURN v_loan_id;
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
    v_earliest_open date;
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

    v_earliest_open := public.get_earliest_open_payroll_date();
    IF v_earliest_open IS NOT NULL AND p_date < v_earliest_open THEN
        RAISE EXCEPTION 'لا يمكن تسجيل سلفة بتاريخ % لأن رواتب هذا الشهر معتمدة أو منتهية. أقرب تاريخ متاح هو %', p_date, v_earliest_open;
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

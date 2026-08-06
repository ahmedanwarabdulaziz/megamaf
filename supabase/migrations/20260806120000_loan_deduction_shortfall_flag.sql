-- approve_payroll_run capacity-caps loan deductions so net pay never goes
-- negative — any installment amount that couldn't be withheld this run
-- silently rolls forward to a future payroll run. Track that shortfall on
-- the payslip so approvers can see it instead of it being invisible.
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS loan_shortfall_amount numeric(18,2) NOT NULL DEFAULT 0;

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
    v_total_due numeric(18,2);
    v_loan_shortfall numeric(18,2);
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

        SELECT COALESCE(SUM(li.scheduled_amount - li.paid_amount), 0) INTO v_total_due
        FROM public.loan_installments li
        JOIN public.employee_loans el ON el.id = li.loan_id
        WHERE el.employee_id = v_payslip.employee_id
          AND el.status = 'active'
          AND li.status = 'pending'
          AND li.due_date <= v_period_end;

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

        v_loan_shortfall := GREATEST(v_total_due - v_total_loan_repaid, 0);

        UPDATE public.payslips
        SET loan_deduction_total = v_total_loan_repaid,
            loan_shortfall_amount = v_loan_shortfall,
            net_amount = v_net_before_loan - v_total_loan_repaid,
            status = 'approved'
        WHERE id = v_payslip.id;
    END LOOP;

    UPDATE public.payroll_runs SET status = 'approved', approved_by = v_emp_id, approved_at = now() WHERE id = p_run_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'approve', 'payroll_run', p_run_id, jsonb_build_object('status', 'approved'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

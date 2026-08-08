-- delete_payroll_run — lets a draft payroll run (e.g. created for the wrong
-- month, or a mistaken generate) be discarded entirely. Restricted to draft:
-- once approved, payslips carry real loan_repayments/payslip_payments rows
-- (ON DELETE RESTRICT), so an approved/paid run can never actually reach this
-- far — this check just gives a clear error instead of a raw FK violation.
-- payroll_runs -> payslips is ON DELETE CASCADE, and payslips -> components/
-- project_allocations are too, so deleting the run row is enough.
CREATE OR REPLACE FUNCTION public.delete_payroll_run(p_run_id uuid) RETURNS void AS $$
DECLARE
    v_creator_id uuid;
    v_status text;
    v_period_year int;
    v_period_month int;
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
        RAISE EXCEPTION 'Only a draft payroll run can be deleted';
    END IF;

    DELETE FROM public.payroll_runs WHERE id = p_run_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_creator_id, 'delete', 'payroll_run', p_run_id, jsonb_build_object('period_year', v_period_year, 'period_month', v_period_month));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

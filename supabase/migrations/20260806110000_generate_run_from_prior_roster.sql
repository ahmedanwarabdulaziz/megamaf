-- When generating a new payroll run, default the roster to whoever had a
-- payslip in the most recently existing prior run, instead of "every
-- currently active employee" — the previous behavior silently pulled in
-- anyone reactivated or newly salaried since the last run, with no trace of
-- why they appeared. Employees still need salary coverage for the new
-- period to actually get a payslip. New hires / reactivations aren't
-- dropped — they're just no longer auto-included; add them via the
-- existing "add employee to run" action once the run is created.
-- If no prior run exists at all (the very first run ever), fall back to
-- the old "all active + salaried employees" behavior since there's no
-- roster to carry forward.
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
    v_prior_run_id uuid;
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

    SELECT id INTO v_prior_run_id
    FROM public.payroll_runs
    WHERE (period_year, period_month) < (p_year, p_month)
    ORDER BY period_year DESC, period_month DESC
    LIMIT 1;

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
          AND (
            v_prior_run_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.payslips p
                WHERE p.payroll_run_id = v_prior_run_id AND p.employee_id = e.id
            )
          )
    LOOP
        PERFORM public.create_payslip_for_employee(v_run_id, v_emp.employee_id, p_year, p_month);
    END LOOP;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_creator_id, 'create', 'payroll_run', v_run_id, jsonb_build_object('period_year', p_year, 'period_month', p_month));

    RETURN v_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

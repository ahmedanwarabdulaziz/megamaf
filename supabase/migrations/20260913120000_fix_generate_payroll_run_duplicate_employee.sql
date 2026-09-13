-- generate_payroll_run joined employees to employee_salaries directly. Since
-- employee_salaries only enforces uniqueness on the single currently-open row
-- (uq_employee_salaries_open), nothing stops an employee from having two rows
-- whose date ranges both cover the same payroll period (overlapping historical
-- rows from a manual edit/import). When that happened, the JOIN returned that
-- employee twice, so create_payslip_for_employee ran twice for the same
-- (run_id, employee_id) and the second insert hit
-- payslips_payroll_run_id_employee_id_key, rolling back the whole run.
-- Switching to EXISTS makes the roster query structurally incapable of
-- returning an employee more than once, regardless of how messy the
-- underlying salary history is.
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
        WHERE e.is_active = true
          AND EXISTS (
            SELECT 1 FROM public.employee_salaries s
            WHERE s.employee_id = e.id
              AND s.effective_from <= v_period_end
              AND (s.effective_to IS NULL OR s.effective_to >= v_period_start)
          )
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

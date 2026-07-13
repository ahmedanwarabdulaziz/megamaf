-- 20260713100000_add_salary_payroll_schema.sql
--
-- Salary / payroll system: base schema.
--   - employees.employment_type distinguishes system-login employees from
--     "payroll-only" people who are on the payroll but never get a login.
--   - employee_salaries is effective-dated (a raise closes the current open
--     row and inserts a new one) so salary history is preserved.
--   - payroll_runs/payslips/payslip_components form a draft -> approved ->
--     paid batch lifecycle, one run per calendar month.
--   - payslip_project_allocations is where each employee's cost is split
--     across projects FOR THAT MONTH — this is a monthly decision (an
--     employee can move between projects run to run), not tied to the salary
--     record. Editable while its payslip is 'draft'; generate_payroll_run
--     copies the employee's most recent prior payslip's split forward as a
--     starting point. This is the table v_project_financial_position reads
--     from, and approve_payroll_run requires it to sum to base_amount before
--     letting the run proceed.
--   - payslip_payments records each individual payment action against a
--     payslip (a payslip can be paid in several partial installments, each
--     funded from a bank account OR from an approved expense belonging to
--     any employee — mirrors how vendor payments can be funded from a bank
--     account or from an employee's expense today).
--   - employee_loans/loan_installments/loan_repayments track principal-only
--     loans repaid either fully from the next salary or via an installment
--     schedule (equal or custom).

-- ============================================================================
-- 1. employees: payroll-only flag
-- ============================================================================

ALTER TABLE public.employees
  ADD COLUMN employment_type text NOT NULL DEFAULT 'system_login'
    CHECK (employment_type IN ('system_login', 'payroll_only'));

-- ============================================================================
-- 2. employee_salaries (effective-dated base salary)
-- ============================================================================

CREATE TABLE public.employee_salaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_to date,
  base_amount numeric(18,2) NOT NULL CHECK (base_amount >= 0),
  notes text,
  created_by uuid REFERENCES public.employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX uq_employee_salaries_open ON public.employee_salaries(employee_id) WHERE effective_to IS NULL;
CREATE INDEX idx_employee_salaries_employee ON public.employee_salaries(employee_id);

-- ============================================================================
-- 4. payroll_runs (monthly batch)
-- ============================================================================

CREATE TABLE public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  notes text,
  created_by uuid REFERENCES public.employees(id),
  approved_by uuid REFERENCES public.employees(id),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (period_year, period_month)
);

-- ============================================================================
-- 5. payslips (one per employee per run)
-- ============================================================================

CREATE TABLE public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  base_amount numeric(18,2) NOT NULL DEFAULT 0,
  allowances_total numeric(18,2) NOT NULL DEFAULT 0,
  bonus_total numeric(18,2) NOT NULL DEFAULT 0,
  deductions_total numeric(18,2) NOT NULL DEFAULT 0,
  loan_deduction_total numeric(18,2) NOT NULL DEFAULT 0,
  gross_amount numeric(18,2) NOT NULL DEFAULT 0,
  net_amount numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX idx_payslips_run ON public.payslips(payroll_run_id);
CREATE INDEX idx_payslips_employee ON public.payslips(employee_id);

-- ============================================================================
-- 6. payslip_components (allowances / deductions / bonus / overtime lines)
-- ============================================================================

CREATE TABLE public.payslip_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id uuid NOT NULL REFERENCES public.payslips(id) ON DELETE CASCADE,
  component_type text NOT NULL CHECK (component_type IN ('allowance', 'deduction', 'bonus', 'overtime')),
  label text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_payslip_components_payslip ON public.payslip_components(payslip_id);

-- Keep payslip totals in sync with its component lines. Overtime is folded
-- into bonus_total (payslips has no separate overtime column). Only recomputes
-- while the payslip is still a draft; approved/paid payslips are frozen snapshots.
CREATE OR REPLACE FUNCTION public.recompute_payslip_totals() RETURNS trigger AS $$
DECLARE
  v_payslip_id uuid;
  v_allowances numeric(18,2);
  v_bonus numeric(18,2);
  v_deductions numeric(18,2);
  v_base numeric(18,2);
  v_loan_deduction numeric(18,2);
BEGIN
  v_payslip_id := COALESCE(NEW.payslip_id, OLD.payslip_id);

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE component_type = 'allowance'), 0),
    COALESCE(SUM(amount) FILTER (WHERE component_type IN ('bonus', 'overtime')), 0),
    COALESCE(SUM(amount) FILTER (WHERE component_type = 'deduction'), 0)
  INTO v_allowances, v_bonus, v_deductions
  FROM public.payslip_components
  WHERE payslip_id = v_payslip_id;

  SELECT base_amount, loan_deduction_total INTO v_base, v_loan_deduction
  FROM public.payslips WHERE id = v_payslip_id;

  UPDATE public.payslips
  SET allowances_total = v_allowances,
      bonus_total = v_bonus,
      deductions_total = v_deductions,
      gross_amount = v_base + v_allowances + v_bonus,
      net_amount = v_base + v_allowances + v_bonus - v_deductions - v_loan_deduction,
      updated_at = now()
  WHERE id = v_payslip_id AND status = 'draft';

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_recompute_payslip_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.payslip_components
  FOR EACH ROW EXECUTE FUNCTION public.recompute_payslip_totals();

-- ============================================================================
-- 7. payslip_project_allocations (this month's cost split -> feeds project
--    costs). Editable while the payslip is 'draft'; approve_payroll_run
--    requires each payslip's rows to sum to its base_amount.
-- ============================================================================

CREATE TABLE public.payslip_project_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id uuid NOT NULL REFERENCES public.payslips(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  allocation_type text NOT NULL CHECK (allocation_type IN ('percentage', 'fixed_amount')),
  allocation_value numeric(18,2) NOT NULL CHECK (allocation_value > 0),
  allocated_amount numeric(18,2) NOT NULL CHECK (allocated_amount > 0),
  created_at timestamptz DEFAULT now(),
  UNIQUE (payslip_id, project_id),
  CHECK (allocation_type <> 'percentage' OR allocation_value <= 100)
);

CREATE INDEX idx_payslip_project_allocations_payslip ON public.payslip_project_allocations(payslip_id);
CREATE INDEX idx_payslip_project_allocations_project ON public.payslip_project_allocations(project_id);

-- ============================================================================
-- 7b. payslip_payments (one row per payment action against a payslip — a
--     payslip can be paid across several partial payments, each funded from
--     a bank account or from an approved expense belonging to any employee)
-- ============================================================================

CREATE TABLE public.payslip_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id uuid NOT NULL REFERENCES public.payslips(id) ON DELETE RESTRICT,
  ledger_entry_id uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
  funding_source text NOT NULL CHECK (funding_source IN ('bank', 'expense')),
  expense_id uuid REFERENCES public.expenses(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_payslip_payments_payslip ON public.payslip_payments(payslip_id);
CREATE INDEX idx_payslip_payments_expense ON public.payslip_payments(expense_id);

-- ============================================================================
-- 8. employee_loans / loan_installments / loan_repayments
-- ============================================================================

CREATE TABLE public.employee_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  principal_amount numeric(18,2) NOT NULL CHECK (principal_amount > 0),
  disbursed_date date NOT NULL,
  repayment_type text NOT NULL CHECK (repayment_type IN ('next_salary_full', 'equal_installments', 'custom_schedule')),
  installment_months int CHECK (installment_months > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  disbursement_ledger_entry_id uuid REFERENCES public.ledger_entries(id),
  notes text,
  created_by uuid REFERENCES public.employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_employee_loans_employee ON public.employee_loans(employee_id);

CREATE TABLE public.loan_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.employee_loans(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  scheduled_amount numeric(18,2) NOT NULL CHECK (scheduled_amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'skipped')),
  paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_loan_installments_loan ON public.loan_installments(loan_id);

CREATE TABLE public.loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.employee_loans(id) ON DELETE RESTRICT,
  installment_id uuid REFERENCES public.loan_installments(id) ON DELETE RESTRICT,
  payslip_id uuid REFERENCES public.payslips(id) ON DELETE RESTRICT,
  ledger_entry_id uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  repayment_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_loan_repayments_loan ON public.loan_repayments(loan_id);
CREATE INDEX idx_loan_repayments_payslip ON public.loan_repayments(payslip_id);

-- ============================================================================
-- 9. updated_at triggers
-- ============================================================================

CREATE TRIGGER trg_set_updated_at_employee_salaries BEFORE UPDATE ON public.employee_salaries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_payroll_runs BEFORE UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_payslips BEFORE UPDATE ON public.payslips FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_employee_loans BEFORE UPDATE ON public.employee_loans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_loan_installments BEFORE UPDATE ON public.loan_installments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 10. RLS: all salary/payroll data is scoped to super admins and employees
--     explicitly granted the 'salary' page (not "viewable by all
--     authenticated" like expenses/deposits — salary data is more sensitive).
-- ============================================================================

ALTER TABLE public.employee_salaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_project_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employee salaries select scoped" ON public.employee_salaries FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));
CREATE POLICY "Employee salaries modifiable by salary access" ON public.employee_salaries FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));

CREATE POLICY "Payroll runs select scoped" ON public.payroll_runs FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));
CREATE POLICY "Payroll runs modifiable by salary access" ON public.payroll_runs FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));

CREATE POLICY "Payslips select scoped" ON public.payslips FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));
CREATE POLICY "Payslips modifiable by salary access" ON public.payslips FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));

CREATE POLICY "Payslip components select scoped" ON public.payslip_components FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));
CREATE POLICY "Payslip components modifiable by salary access" ON public.payslip_components FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));

CREATE POLICY "Payslip project allocations select scoped" ON public.payslip_project_allocations FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));
CREATE POLICY "Payslip project allocations modifiable by salary access" ON public.payslip_project_allocations FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));

CREATE POLICY "Payslip payments select scoped" ON public.payslip_payments FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));
CREATE POLICY "Payslip payments modifiable by salary access" ON public.payslip_payments FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));

CREATE POLICY "Employee loans select scoped" ON public.employee_loans FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));
CREATE POLICY "Employee loans modifiable by salary access" ON public.employee_loans FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));

CREATE POLICY "Loan installments select scoped" ON public.loan_installments FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));
CREATE POLICY "Loan installments modifiable by salary access" ON public.loan_installments FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));

CREATE POLICY "Loan repayments select scoped" ON public.loan_repayments FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));
CREATE POLICY "Loan repayments modifiable by salary access" ON public.loan_repayments FOR ALL TO authenticated USING (public.is_super_admin() OR public.has_page_access('salary'));

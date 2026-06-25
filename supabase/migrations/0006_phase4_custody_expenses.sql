-- 0006_phase4_custody_expenses.sql

-- 1. Extend Employees
ALTER TABLE public.employees ADD COLUMN has_custody_access boolean DEFAULT false;

-- 2. Expense Categories
CREATE TABLE public.expense_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    parent_id uuid REFERENCES public.expense_categories(id) ON DELETE CASCADE,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. Expenses
CREATE TABLE public.expenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT,
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    category_id uuid NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
    expense_date date NOT NULL,
    amount numeric(18,2) NOT NULL CHECK (amount > 0),
    notes text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by uuid REFERENCES public.employees(id) ON DELETE RESTRICT,
    approved_at timestamptz,
    settled_amount numeric(18,2) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 4. Custody Settlements
CREATE TABLE public.custody_settlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
    disbursement_ledger_id uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
    amount numeric(18,2) NOT NULL CHECK (amount > 0),
    created_at timestamptz DEFAULT now()
);

-- 5. Views
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
    WHERE status = 'approved'
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

-- 6. RPCs

-- settle_employee_custody
CREATE OR REPLACE FUNCTION public.settle_employee_custody(p_employee_id uuid) RETURNS void AS $$
DECLARE
    v_expense record;
    v_disb record;
    v_expense_remaining numeric;
    v_disb_remaining numeric;
    v_settle_amount numeric;
BEGIN
    FOR v_expense IN 
        SELECT id, amount, settled_amount 
        FROM public.expenses 
        WHERE employee_id = p_employee_id 
          AND status = 'approved' 
          AND amount > settled_amount 
        ORDER BY expense_date ASC, id ASC
    LOOP
        v_expense_remaining := v_expense.amount - v_expense.settled_amount;

        FOR v_disb IN 
            SELECT le.id, le.amount, 
                   COALESCE(SUM(cs.amount), 0) AS allocated_amount
            FROM public.ledger_entries le
            LEFT JOIN public.custody_settlements cs ON le.id = cs.disbursement_ledger_id
            WHERE le.employee_id = p_employee_id 
              AND le.category = 'custody_disbursement' 
              AND le.direction = 'in'
            GROUP BY le.id, le.amount, le.entry_date
            HAVING le.amount > COALESCE(SUM(cs.amount), 0)
            ORDER BY le.entry_date ASC, le.id ASC
        LOOP
            v_disb_remaining := v_disb.amount - v_disb.allocated_amount;
            
            IF v_disb_remaining > 0 AND v_expense_remaining > 0 THEN
                v_settle_amount := LEAST(v_disb_remaining, v_expense_remaining);
                
                INSERT INTO public.custody_settlements (employee_id, expense_id, disbursement_ledger_id, amount)
                VALUES (p_employee_id, v_expense.id, v_disb.id, v_settle_amount);
                
                v_expense_remaining := v_expense_remaining - v_settle_amount;
                
                UPDATE public.expenses 
                SET settled_amount = settled_amount + v_settle_amount 
                WHERE id = v_expense.id;
            END IF;

            IF v_expense_remaining <= 0 THEN
                EXIT;
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- approve_expense
CREATE OR REPLACE FUNCTION public.approve_expense(p_expense_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id uuid;
    v_target_employee uuid;
    v_status text;
    v_can_approve boolean;
BEGIN
    v_employee_id := public.current_employee_id();

    SELECT can_approve INTO v_can_approve FROM public.employees WHERE id = v_employee_id;
    
    IF NOT v_can_approve AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to approve expenses';
    END IF;

    SELECT employee_id, status INTO v_target_employee, v_status FROM public.expenses WHERE id = p_expense_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
    IF v_status != 'pending' THEN RAISE EXCEPTION 'Expense already processed'; END IF;

    UPDATE public.expenses 
    SET status = 'approved', approved_by = v_employee_id, approved_at = now() 
    WHERE id = p_expense_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_employee_id, 'approve', 'expense', p_expense_id, jsonb_build_object('status', 'approved'));

    PERFORM public.settle_employee_custody(v_target_employee);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- disburse_custody
CREATE OR REPLACE FUNCTION public.disburse_custody(
    p_bank_account_id uuid,
    p_employee_id uuid,
    p_amount numeric,
    p_date date,
    p_memo text
) RETURNS uuid AS $$
DECLARE
    v_creator_id uuid;
    v_out_id uuid;
    v_in_id uuid;
BEGIN
    IF NOT public.has_page_access('treasury/custody') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    v_creator_id := public.current_employee_id();

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, memo, created_by, counterparty_type, counterparty_id
    ) VALUES (
        p_date, 'out', p_amount, 'custody_disbursement', p_bank_account_id, p_memo, v_creator_id, 'employee', p_employee_id
    ) RETURNING id INTO v_out_id;

    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, employee_id, memo, created_by, counterparty_type, counterparty_id
    ) VALUES (
        p_date, 'in', p_amount, 'custody_disbursement', p_employee_id, p_memo, v_creator_id, 'bank', p_bank_account_id
    ) RETURNING id INTO v_in_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_creator_id, 'create', 'custody_disbursement', v_out_id, 
        jsonb_build_object('bank_account_id', p_bank_account_id, 'employee_id', p_employee_id, 'amount', p_amount)
    );

    PERFORM public.settle_employee_custody(p_employee_id);

    RETURN v_in_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- reject_expense
CREATE OR REPLACE FUNCTION public.reject_expense(p_expense_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id uuid;
    v_status text;
    v_can_approve boolean;
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Triggers
CREATE TRIGGER trg_set_updated_at_exp_cats BEFORE UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_expenses BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. Indexes
CREATE INDEX idx_expenses_employee_id ON public.expenses(employee_id);
CREATE INDEX idx_expenses_status ON public.expenses(status);
CREATE INDEX idx_expenses_date ON public.expenses(expense_date);
CREATE INDEX idx_custody_settlements_employee_id ON public.custody_settlements(employee_id);

-- 9. RLS Policies
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expense categories viewable by all authenticated users" ON public.expense_categories
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Expense categories editable by super admins" ON public.expense_categories
    FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Expenses viewable by creator or approvers" ON public.expenses
    FOR SELECT TO authenticated USING (
        employee_id = public.current_employee_id() 
        OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
        OR public.is_super_admin()
    );

CREATE POLICY "Expenses insertable by self if custody access" ON public.expenses
    FOR INSERT TO authenticated WITH CHECK (
        employee_id = public.current_employee_id() AND
        (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
    );

CREATE POLICY "Custody settlements viewable by employee or treasury" ON public.custody_settlements
    FOR SELECT TO authenticated USING (
        employee_id = public.current_employee_id()
        OR public.has_page_access('treasury/custody')
        OR public.is_super_admin()
    );

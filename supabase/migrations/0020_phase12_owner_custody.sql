-- 0020_phase12_owner_custody.sql
-- Extends the expense and custody systems to support project owners.

-- ============================================================
-- 1. Make expenses.employee_id nullable
-- ============================================================
ALTER TABLE public.expenses ALTER COLUMN employee_id DROP NOT NULL;

-- ============================================================
-- 2. Add owner_id FK to expenses
-- ============================================================
ALTER TABLE public.expenses
  ADD COLUMN owner_id uuid REFERENCES public.project_owners(id) ON DELETE RESTRICT;

-- At least one of employee_id / owner_id must be set
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_party_check
  CHECK (employee_id IS NOT NULL OR owner_id IS NOT NULL);

-- Index for owner expense queries
CREATE INDEX idx_expenses_owner_id ON public.expenses(owner_id);

-- ============================================================
-- 3. Create owner_custody_disbursements table
-- ============================================================
CREATE TABLE public.owner_custody_disbursements (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid        NOT NULL REFERENCES public.project_owners(id) ON DELETE RESTRICT,
  bank_account_id   uuid        NOT NULL REFERENCES public.bank_accounts(id)  ON DELETE RESTRICT,
  amount            numeric(18,2) NOT NULL CHECK (amount > 0),
  disbursement_date date        NOT NULL,
  memo              text        NOT NULL DEFAULT '',
  created_by        uuid        NOT NULL REFERENCES public.employees(id),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_owner_custody_disbursements_owner ON public.owner_custody_disbursements(owner_id);

-- ============================================================
-- 4. RLS for owner_custody_disbursements
-- ============================================================
ALTER TABLE public.owner_custody_disbursements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner custody disbursements: viewable by treasury or admin"
  ON public.owner_custody_disbursements
  FOR SELECT TO authenticated
  USING (public.has_page_access('treasury/custody') OR public.is_super_admin());

CREATE POLICY "Owner custody disbursements: insertable by treasury or admin"
  ON public.owner_custody_disbursements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_page_access('treasury/custody') OR public.is_super_admin());

-- ============================================================
-- 5. Update expenses INSERT policy to also allow admin/approver
--    to create expenses on behalf of owners
-- ============================================================
DROP POLICY IF EXISTS "Expenses insertable by self if custody access" ON public.expenses;

CREATE POLICY "Expenses insertable"
  ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Employee submitting their own expense (must have custody access)
    (
      employee_id IS NOT NULL
      AND employee_id = public.current_employee_id()
      AND (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
    )
    OR
    -- Admin/approver creating an expense on behalf of an owner
    (
      owner_id IS NOT NULL
      AND employee_id IS NULL
      AND (
        (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
        OR public.is_super_admin()
      )
    )
  );

-- ============================================================
-- 6. Update approve_expense RPC to skip settlement for owner expenses
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_expense(p_expense_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id    uuid;
    v_target_employee uuid;
    v_status         text;
    v_can_approve    boolean;
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. Create disburse_owner_custody RPC
--    Deducts from bank via ledger_entries + records in owner table
-- ============================================================
CREATE OR REPLACE FUNCTION public.disburse_owner_custody(
  p_bank_account_id uuid,
  p_owner_id        uuid,
  p_amount          numeric,
  p_date            date,
  p_memo            text
) RETURNS uuid AS $$
DECLARE
  v_creator_id uuid;
  v_disb_id    uuid;
BEGIN
  IF NOT public.has_page_access('treasury/custody') AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  v_creator_id := public.current_employee_id();

  -- Deduct from the bank account (shows up in bank statement)
  INSERT INTO public.ledger_entries (
    entry_date, direction, amount, category,
    bank_account_id, memo, created_by,
    counterparty_type, counterparty_id
  ) VALUES (
    p_date, 'out', p_amount, 'custody_disbursement',
    p_bank_account_id, p_memo, v_creator_id,
    'owner', p_owner_id
  );

  -- Record in owner custody table (source of truth for balance view)
  INSERT INTO public.owner_custody_disbursements (
    owner_id, bank_account_id, amount, disbursement_date, memo, created_by
  ) VALUES (
    p_owner_id, p_bank_account_id, p_amount, p_date, p_memo, v_creator_id
  ) RETURNING id INTO v_disb_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (
    v_creator_id, 'create', 'owner_custody_disbursement', v_disb_id,
    jsonb_build_object('owner_id', p_owner_id, 'amount', p_amount)
  );

  RETURN v_disb_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. Create v_owner_custody_balance view
-- ============================================================
CREATE OR REPLACE VIEW public.v_owner_custody_balance WITH (security_invoker = true) AS
SELECT
  o.id    AS owner_id,
  o.name,
  COALESCE(disb.total_disbursed, 0)        AS total_disbursed,
  COALESCE(exp.total_approved_expenses, 0) AS total_approved_expenses,
  COALESCE(disb.total_disbursed, 0) - COALESCE(exp.total_approved_expenses, 0) AS balance
FROM public.project_owners o
LEFT JOIN (
  SELECT owner_id, SUM(amount) AS total_disbursed
  FROM public.owner_custody_disbursements
  GROUP BY owner_id
) disb ON o.id = disb.owner_id
LEFT JOIN (
  SELECT owner_id, SUM(amount) AS total_approved_expenses
  FROM public.expenses
  WHERE status = 'approved' AND owner_id IS NOT NULL
  GROUP BY owner_id
) exp ON o.id = exp.owner_id
WHERE disb.total_disbursed IS NOT NULL
   OR exp.total_approved_expenses IS NOT NULL;

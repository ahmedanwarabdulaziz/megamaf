-- 20260814150000_expense_funding_source.sql
--
-- New feature: specific employees (flagged via employees.has_expense_funding_access)
-- can, when submitting an expense, choose a funding source at submission time —
-- either a bank account or another employee's custody — instead of the expense
-- just offsetting against their own custody balance like today. The expense
-- still goes through the normal pending -> admin-approval flow with free choice
-- of project/category. The moment approve_expense() approves it, the chosen
-- disbursement happens atomically in that same call:
--   - 'bank'            -> one ledger_entries row out of that bank account.
--   - 'employee_custody' -> a real, already-approved mirror expense is booked
--                           against the funding employee's own account (fixed
--                           category, main-company project so it doesn't
--                           double-count the requester's real project cost),
--                           which flows through the SAME settle_employee_custody
--                           FIFO as any normal approved expense.
--
-- Generalizes the exact pattern already proven for salary loans in
-- 20260721100000_loan_disbursement_from_expense.sql / 20260805100000_bank_loan_approval.sql
-- (a pending expense + a side "how is this funded" record, resolved only at
-- approval time inside approve_expense — the one true approval choke point).
-- reject_expense needs no changes: nothing is created until approval succeeds,
-- so a reject on a funded pending expense is just a normal rejection.
--
-- Confirmed against production before writing this file (no staging exists):
--   - expenses has no expense_number column (pre-existing, unrelated drift —
--     approveExpense/rejectExpense's push-notification lookups have been
--     silently failing; not touched by this migration).
--   - Two permissive INSERT policies are simultaneously live on expenses today
--     ("Expenses insert scoped" from 0007_phase4_hardening.sql, never dropped
--     by name since, OR'd with "Expenses insertable" from 0022). Both are
--     dropped by their exact live names below before the replacement is created,
--     otherwise the older policy (which has no awareness of funding_type at
--     all) could be used to bypass the new permission check entirely.

-- ============================================================================
-- 1. employees: new independent capability flag, default false (invisible
--    until specifically granted; does not require has_custody_access).
-- ============================================================================

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS has_expense_funding_access boolean DEFAULT false;

-- ============================================================================
-- 2. expenses: funding columns. All nullable — every existing row keeps
--    funding_type NULL, i.e. today's behavior, completely unchanged.
-- ============================================================================

ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS funding_type text,
    ADD COLUMN IF NOT EXISTS funding_bank_account_id uuid REFERENCES public.bank_accounts(id),
    ADD COLUMN IF NOT EXISTS funding_employee_id uuid REFERENCES public.employees(id),
    ADD COLUMN IF NOT EXISTS disbursement_ledger_entry_id uuid REFERENCES public.ledger_entries(id),
    ADD COLUMN IF NOT EXISTS funding_mirror_expense_id uuid REFERENCES public.expenses(id);

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_funding_type_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_funding_type_check
    CHECK (funding_type IS NULL OR funding_type IN ('bank', 'employee_custody'));

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_funding_consistency;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_funding_consistency CHECK (
    (funding_type IS NULL AND funding_bank_account_id IS NULL AND funding_employee_id IS NULL)
    OR (funding_type = 'bank' AND funding_bank_account_id IS NOT NULL AND funding_employee_id IS NULL)
    OR (funding_type = 'employee_custody' AND funding_employee_id IS NOT NULL AND funding_bank_account_id IS NULL
        AND (employee_id IS NULL OR funding_employee_id <> employee_id))
);

-- ============================================================================
-- 3. Fixed mirror-expense category — pinned to the main-company project,
--    exactly like the loan-advance category ('...0010'), for the same reason:
--    the requester's own expense already carries the real project_id/category
--    and is what must drive that project's cost. The mirror expense booked to
--    the funding employee must not also hit that project.
-- ============================================================================

INSERT INTO public.expense_categories (id, name, is_active)
VALUES ('00000000-0000-0000-0000-000000000011', 'تمويل مصروف موظف آخر', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.expense_category_scopes (category_id, scope)
SELECT '00000000-0000-0000-0000-000000000011', 'main_company'
WHERE NOT EXISTS (
    SELECT 1 FROM public.expense_category_scopes
    WHERE category_id = '00000000-0000-0000-0000-000000000011' AND scope = 'main_company'
);

-- ============================================================================
-- 4. New ledger category 'expense_disbursement', reused for both funding
--    branches — same additive pattern used to add 'expense_direct' in
--    20260714090000_direct_expense.sql.
-- ============================================================================

ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_category_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_category_check CHECK (
    category IN (
        'opening_balance',
        'bank_in',
        'bank_out',
        'custody_disbursement',
        'vendor_payment',
        'owner_payment',
        'deposit_collection',
        'deposit_principal_return',
        'interest',
        'deduction',
        'transfer_in',
        'transfer_out',
        'salary_payment',
        'loan_disbursement',
        'loan_repayment',
        'expense_direct',
        'expense_disbursement'
    )
);

-- ============================================================================
-- 5. v_expense_vendor_paid: include 'expense_disbursement' so an
--    employee_custody-funded mirror expense (is_direct=false) shows zero
--    remaining balance to the vendor/salary "pay from expense" pickers —
--    otherwise it would look reusable as a funding source a second time.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_expense_vendor_paid WITH (security_invoker = true) AS
SELECT
    e.id AS expense_id,
    COALESCE(SUM(le.amount), 0) AS paid_amount
FROM public.expenses e
LEFT JOIN public.ledger_entries le
    ON le.source_type = 'expense'
   AND le.source_id = e.id
   AND le.category IN ('vendor_payment', 'salary_payment', 'loan_disbursement', 'expense_disbursement')
GROUP BY e.id;

-- ============================================================================
-- 6. approve_expense — the single approval choke point. When funding_type IS
--    NULL every existing branch (plain custody FIFO, the employee_loans
--    block) runs exactly as it does today. New behavior only fires when the
--    requester chose a funding source at submission time.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_expense(p_expense_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id                uuid;
    v_target_employee            uuid;
    v_status                     text;
    v_can_approve                boolean;
    v_is_direct                  boolean;
    v_amount                     numeric;
    v_expense_date               date;
    v_notes                      text;
    v_funding_type               text;
    v_funding_bank_account_id    uuid;
    v_funding_employee_id        uuid;
    v_will_be_direct             boolean;
    v_disb_ledger_id             uuid;
    v_mirror_expense_id          uuid;
    v_loan                       record;
    v_ledger_id                  uuid;
    v_main_company_project_id CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
    v_funding_mirror_category_id CONSTANT uuid := '00000000-0000-0000-0000-000000000011';
BEGIN
    v_employee_id := public.current_employee_id();

    SELECT can_approve INTO v_can_approve FROM public.employees WHERE id = v_employee_id;
    IF NOT v_can_approve AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to approve expenses';
    END IF;

    SELECT employee_id, status, is_direct, amount, expense_date, notes,
           funding_type, funding_bank_account_id, funding_employee_id
    INTO v_target_employee, v_status, v_is_direct, v_amount, v_expense_date, v_notes,
         v_funding_type, v_funding_bank_account_id, v_funding_employee_id
    FROM public.expenses WHERE id = p_expense_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
    IF v_status != 'pending' THEN RAISE EXCEPTION 'Expense already processed'; END IF;

    -- An expense funded from a bank account or another employee's custody
    -- never touches the requester's own custody FIFO — same exclusion
    -- mechanism is_direct expenses already use everywhere else in the app.
    v_will_be_direct := v_is_direct OR (v_funding_type IS NOT NULL);

    UPDATE public.expenses
    SET status = 'approved',
        approved_by = v_employee_id,
        approved_at = now(),
        is_direct = v_will_be_direct,
        settled_amount = CASE WHEN v_will_be_direct THEN v_amount ELSE settled_amount END
    WHERE id = p_expense_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_employee_id, 'approve', 'expense', p_expense_id, jsonb_build_object('status', 'approved'));

    IF v_target_employee IS NOT NULL AND NOT v_will_be_direct THEN
        PERFORM public.settle_employee_custody(v_target_employee);
    END IF;

    -- ── New: atomic funding disbursement chosen at submission time ────────
    IF v_funding_type IS NOT NULL THEN
        IF v_funding_type = 'bank' THEN
            INSERT INTO public.ledger_entries (
                entry_date, direction, amount, category, bank_account_id, employee_id,
                memo, created_by, counterparty_type, counterparty_id, source_type, source_id
            ) VALUES (
                v_expense_date, 'out', v_amount, 'expense_disbursement', v_funding_bank_account_id, v_target_employee,
                v_notes, v_employee_id, 'employee', v_target_employee, 'expense', p_expense_id
            ) RETURNING id INTO v_disb_ledger_id;

        ELSE -- 'employee_custody'
            INSERT INTO public.ledger_entries (
                entry_date, direction, amount, category, employee_id,
                memo, created_by, counterparty_type, counterparty_id, source_type, source_id
            ) VALUES (
                v_expense_date, 'out', v_amount, 'expense_disbursement', v_target_employee,
                v_notes, v_employee_id, 'employee', v_target_employee, 'expense', p_expense_id
            ) RETURNING id INTO v_disb_ledger_id;

            -- Auto-create an already-approved mirror expense on the funding
            -- employee's account: fixed category, main-company project (so it
            -- never hits the requester's real project cost a second time),
            -- is_direct=false so it flows through the SAME
            -- settle_employee_custody FIFO as any other real spend.
            INSERT INTO public.expenses (
                project_id, employee_id, category_id, expense_date, amount, notes,
                status, approved_by, approved_at, settled_amount, is_direct
            ) VALUES (
                v_main_company_project_id, v_funding_employee_id, v_funding_mirror_category_id, v_expense_date, v_amount,
                'تمويل مصروف رقم ' || p_expense_id::text, 'approved', v_employee_id, now(), 0, false
            ) RETURNING id INTO v_mirror_expense_id;

            UPDATE public.expenses SET funding_mirror_expense_id = v_mirror_expense_id WHERE id = p_expense_id;

            PERFORM public.settle_employee_custody(v_funding_employee_id);

            INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
            VALUES (v_employee_id, 'create', 'expense', v_mirror_expense_id,
                jsonb_build_object('funding_employee_id', v_funding_employee_id, 'amount', v_amount, 'funds_expense_id', p_expense_id));
        END IF;

        UPDATE public.expenses SET disbursement_ledger_entry_id = v_disb_ledger_id WHERE id = p_expense_id;

        INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
        VALUES (v_employee_id, 'update', 'expense', p_expense_id,
            jsonb_build_object('funding_type', v_funding_type, 'disbursement_ledger_entry_id', v_disb_ledger_id));
    END IF;

    -- ── Unchanged: existing loan-linked branch ─────────────────────────────
    SELECT * INTO v_loan FROM public.employee_loans WHERE expense_id = p_expense_id AND status = 'pending' FOR UPDATE;
    IF FOUND THEN
        IF v_loan.funding_source = 'bank' THEN
            INSERT INTO public.ledger_entries (
                entry_date, direction, amount, category, bank_account_id, employee_id, memo, created_by, counterparty_type, counterparty_id, source_type, source_id
            ) VALUES (
                v_loan.disbursed_date, 'out', v_loan.principal_amount, 'loan_disbursement', v_loan.bank_account_id, v_loan.employee_id, v_loan.notes, v_employee_id, 'employee', v_loan.employee_id, 'expense', p_expense_id
            ) RETURNING id INTO v_ledger_id;
        ELSE
            INSERT INTO public.ledger_entries (
                entry_date, direction, amount, category, employee_id, memo, created_by, counterparty_type, counterparty_id, source_type, source_id
            ) VALUES (
                v_loan.disbursed_date, 'out', v_loan.principal_amount, 'loan_disbursement', v_loan.employee_id, v_loan.notes, v_employee_id, 'employee', v_loan.employee_id, 'expense', p_expense_id
            ) RETURNING id INTO v_ledger_id;
        END IF;

        UPDATE public.employee_loans SET status = 'active', disbursement_ledger_entry_id = v_ledger_id WHERE id = v_loan.id;

        INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
        VALUES (v_employee_id, 'update', 'employee_loan', v_loan.id, jsonb_build_object('status', 'active', 'expense_id', p_expense_id));
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. RLS: expenses INSERT policy. Confirmed live today (2026-08-14) that BOTH
--    "Expenses insert scoped" (0007_phase4_hardening.sql, never dropped by
--    name since) and "Expenses insertable" (0022_patch_expense_admin_insert.sql)
--    are simultaneously active, OR'd together by Postgres. Both are dropped
--    by their exact live names before the replacement is created — otherwise
--    "Expenses insert scoped" (which has no awareness of funding_type at all)
--    could be used to bypass the new permission check below entirely.
-- ============================================================================

DROP POLICY IF EXISTS "Expenses insert scoped" ON public.expenses;
DROP POLICY IF EXISTS "Expenses insertable by self if custody access" ON public.expenses;
DROP POLICY IF EXISTS "Expenses insertable" ON public.expenses;

CREATE POLICY "Expenses insertable" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    -- New columns can never be smuggled in pre-approved (defense in depth).
    disbursement_ledger_entry_id IS NULL
    AND funding_mirror_expense_id IS NULL
    AND (
      funding_type IS NULL
      OR (
        employee_id = public.current_employee_id()
        AND (SELECT has_expense_funding_access FROM public.employees WHERE id = public.current_employee_id())
      )
    )
    AND (
      -- (1) Employee submitting their own expense — has_custody_access OR
      --     has_expense_funding_access, fully independent flags.
      (
        employee_id IS NOT NULL
        AND employee_id = public.current_employee_id()
        AND (
          (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
          OR (SELECT has_expense_funding_access FROM public.employees WHERE id = public.current_employee_id())
        )
      )
      OR
      -- (2) Super admin submitting on behalf of ANY employee — unchanged.
      (
        employee_id IS NOT NULL
        AND owner_id IS NULL
        AND public.is_super_admin()
      )
      OR
      -- (3) Admin/approver creating an expense on behalf of an owner — unchanged.
      (
        owner_id IS NOT NULL
        AND employee_id IS NULL
        AND (
          (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
          OR public.is_super_admin()
        )
      )
    )
  );

-- 20260723130000_add_expense_rejection_reason.sql
--
-- Admins rejecting an expense need to leave a reason so the submitter knows
-- what to fix before resubmitting. Adds a rejection_reason column and wires
-- it through reject_expense(). Resubmitting (update_expense sets status back
-- to 'pending' from the app layer) clears the old reason since it no longer
-- applies to the edited expense.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE OR REPLACE FUNCTION public.reject_expense(p_expense_id uuid, p_reason text DEFAULT NULL)
RETURNS void AS $$
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
    SET status = 'rejected', approved_by = v_employee_id, approved_at = now(), rejection_reason = p_reason
    WHERE id = p_expense_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_employee_id, 'reject', 'expense', p_expense_id, jsonb_build_object('status', 'rejected', 'rejection_reason', p_reason));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

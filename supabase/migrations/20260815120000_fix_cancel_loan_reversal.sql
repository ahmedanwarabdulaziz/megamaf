-- 20260815120000_fix_cancel_loan_reversal.sql
--
-- Bug: cancel_loan() lets you cancel an already-disbursed ('active') loan
-- (that's the whole point — undo a disbursement before any repayment has
-- happened) but never reversed the disbursement itself:
--   - the funding expense stayed 'approved', so v_employee_custody_balance
--     (SUM(amount) WHERE status='approved') kept counting it forever — a
--     custody-funded loan cancellation left the custody holder's balance
--     permanently short by the loan amount, with no loan left to explain it.
--   - the 'loan_disbursement' ledger entry (bank-funded: tied to a real bank
--     account) was never removed, so a cancelled bank loan left the bank
--     balance permanently short too.
--
-- Confirmed live: loan 07c0cc3a-bcb2-4aa8-bbbd-aa08ac3cabba (employee
-- 1a1a9d83-0a42-4a73-9b15-de44018d6c04, دياب غفير) was approved then
-- cancelled today with zero repayments, leaving
-- v_employee_custody_balance.balance at -2000 with nothing pending to
-- justify it.
--
-- Fix: on cancelling an active loan, delete the disbursement ledger entry
-- and reject the funding expense (clearing any custody_settlements already
-- matched against it), exactly undoing what approve_expense's loan branch
-- did. Then, as a one-time data fix, reverse that specific already-broken
-- loan the same way.

CREATE OR REPLACE FUNCTION public.cancel_loan(p_loan_id uuid) RETURNS void AS $$
DECLARE
    v_creator_id uuid;
    v_loan record;
    v_repayment_count int;
BEGIN
    IF NOT public.has_page_access('salary', 'edit') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_creator_id := public.current_employee_id();

    SELECT * INTO v_loan FROM public.employee_loans WHERE id = p_loan_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan not found';
    END IF;
    IF v_loan.status <> 'active' THEN
        RAISE EXCEPTION 'Only an active loan can be cancelled';
    END IF;

    SELECT count(*) INTO v_repayment_count FROM public.loan_repayments WHERE loan_id = p_loan_id;
    IF v_repayment_count > 0 THEN
        RAISE EXCEPTION 'Cannot cancel a loan that already has repayments';
    END IF;

    UPDATE public.employee_loans SET status = 'cancelled', disbursement_ledger_entry_id = NULL WHERE id = p_loan_id;
    UPDATE public.loan_installments SET status = 'skipped' WHERE loan_id = p_loan_id AND status = 'pending';

    -- Reverse the disbursement ledger entry (bank balance or otherwise).
    IF v_loan.disbursement_ledger_entry_id IS NOT NULL THEN
        DELETE FROM public.ledger_entries WHERE id = v_loan.disbursement_ledger_entry_id;
    END IF;

    -- Reverse the funding expense's approval so it stops counting as spent
    -- custody (v_employee_custody_balance) or a real vendor-paid disbursement.
    IF v_loan.expense_id IS NOT NULL THEN
        DELETE FROM public.custody_settlements WHERE expense_id = v_loan.expense_id;
        UPDATE public.expenses
        SET status = 'rejected',
            settled_amount = 0,
            approved_by = v_creator_id,
            approved_at = now(),
            rejection_reason = 'تم إلغاء السلفة الممولة من هذا المصروف'
        WHERE id = v_loan.expense_id;
    END IF;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        v_creator_id, 'update', 'employee_loan', p_loan_id,
        jsonb_build_object('status', 'cancelled', 'reversed_expense_id', v_loan.expense_id, 'reversed_ledger_entry_id', v_loan.disbursement_ledger_entry_id)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- One-time data fix for the already-broken loan described above. Scoped to
-- its exact ids so this is a no-op if already fixed or never applicable.
-- ============================================================================

DO $$
DECLARE
    v_loan_id CONSTANT uuid := '07c0cc3a-bcb2-4aa8-bbbd-aa08ac3cabba';
    v_expense_id CONSTANT uuid := '2f0ded85-77a5-4407-8630-974093075e58';
    v_ledger_id CONSTANT uuid := '5af6ab93-e63d-4036-b66a-485b81b0e483';
BEGIN
    IF EXISTS (SELECT 1 FROM public.employee_loans WHERE id = v_loan_id AND status = 'cancelled' AND disbursement_ledger_entry_id = v_ledger_id) THEN
        UPDATE public.employee_loans SET disbursement_ledger_entry_id = NULL WHERE id = v_loan_id;
        DELETE FROM public.ledger_entries WHERE id = v_ledger_id;
        DELETE FROM public.custody_settlements WHERE expense_id = v_expense_id;
        UPDATE public.expenses
        SET status = 'rejected', settled_amount = 0, rejection_reason = 'تم إلغاء السلفة الممولة من هذا المصروف (تصحيح بيانات)'
        WHERE id = v_expense_id AND status = 'approved';
    END IF;
END;
$$;

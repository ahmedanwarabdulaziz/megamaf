-- 20260920110000_block_direct_vendor_payments_for_funding_access.sql
--
-- Rule: a NON-super-admin employee who holds employees.has_expense_funding_access
-- ("يمكنه اختيار مصدر تمويل (بنك / عهدة موظف آخر) عند تسجيل مصروف أو دفعة لمقاول")
-- must never be able to make a vendor payment that deducts money immediately —
-- neither from a bank account ("من الخزينة / حساب بنكي") nor from an employee's
-- approved expense ("من عهدة موظف (مصروف معتمد)"), nor by settling existing
-- vendor credit. Their ONLY route is request_vendor_payment
-- (20260920100000_vendor_payment_requests.sql), which waits for an approver.
--
-- Hiding the buttons in the UI is not enough — the RPCs are callable directly
-- with the employee's own session — so the rule is enforced in the database.
--
-- The four direct functions (record_vendor_payment,
-- record_vendor_payment_from_expense, assign_vendor_payment, pay_prior_claim)
-- are NOT re-written: each is renamed to _direct_<name> (its exact current logic,
-- untouched) and replaced by a thin wrapper with the same signature that first
-- checks the rule, then delegates. The renamed implementations are revoked from
-- every client role so they can only be reached through the guarded wrappers.
-- Super admins and everyone without the flag are completely unaffected.
--
-- Direct INSERTs into ledger_entries are already super-admin-only by RLS
-- (0005_phase3_hardening.sql), so these RPCs are the only direct routes.

CREATE OR REPLACE FUNCTION public.assert_not_funding_access_restricted() RETURNS void AS $$
BEGIN
    IF NOT public.is_super_admin()
       AND COALESCE((SELECT has_expense_funding_access FROM public.employees WHERE id = public.current_employee_id()), false)
    THEN
        RAISE EXCEPTION 'Employees with funding-source access cannot pay vendors directly — submit the payment as a request for approval';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.assert_not_funding_access_restricted() FROM PUBLIC;

-- ── record_vendor_payment ────────────────────────────────────────────────
ALTER FUNCTION public.record_vendor_payment(uuid, uuid, numeric, text, jsonb, uuid)
    RENAME TO _direct_record_vendor_payment;
REVOKE ALL ON FUNCTION public._direct_record_vendor_payment(uuid, uuid, numeric, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_vendor_payment(
    p_bank_account_id uuid,
    p_vendor_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb,
    p_project_id uuid DEFAULT NULL
) RETURNS uuid AS $$
BEGIN
    PERFORM public.assert_not_funding_access_restricted();
    RETURN public._direct_record_vendor_payment(p_bank_account_id, p_vendor_id, p_amount, p_memo, p_allocations, p_project_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── record_vendor_payment_from_expense ───────────────────────────────────
ALTER FUNCTION public.record_vendor_payment_from_expense(uuid, uuid, uuid, numeric, text, jsonb, uuid)
    RENAME TO _direct_record_vendor_payment_from_expense;
REVOKE ALL ON FUNCTION public._direct_record_vendor_payment_from_expense(uuid, uuid, uuid, numeric, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_vendor_payment_from_expense(
    p_employee_id uuid,
    p_expense_id  uuid,
    p_vendor_id   uuid,
    p_amount      numeric,
    p_memo        text,
    p_allocations jsonb,
    p_project_id  uuid DEFAULT NULL
) RETURNS uuid AS $$
BEGIN
    PERFORM public.assert_not_funding_access_restricted();
    RETURN public._direct_record_vendor_payment_from_expense(p_employee_id, p_expense_id, p_vendor_id, p_amount, p_memo, p_allocations, p_project_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── assign_vendor_payment (settle from existing vendor credit) ───────────
ALTER FUNCTION public.assign_vendor_payment(uuid, uuid, jsonb)
    RENAME TO _direct_assign_vendor_payment;
REVOKE ALL ON FUNCTION public._direct_assign_vendor_payment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.assign_vendor_payment(
    p_ledger_entry_id uuid,
    p_project_id      uuid,
    p_allocations     jsonb
) RETURNS void AS $$
BEGIN
    PERFORM public.assert_not_funding_access_restricted();
    PERFORM public._direct_assign_vendor_payment(p_ledger_entry_id, p_project_id, p_allocations);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── pay_prior_claim (opening-balance claim #0 payment) ───────────────────
ALTER FUNCTION public.pay_prior_claim(uuid, uuid, numeric)
    RENAME TO _direct_pay_prior_claim;
REVOKE ALL ON FUNCTION public._direct_pay_prior_claim(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.pay_prior_claim(
    p_prior_claim_id uuid,
    p_vendor_id      uuid,
    p_amount         numeric
) RETURNS void AS $$
BEGIN
    PERFORM public.assert_not_funding_access_restricted();
    PERFORM public._direct_pay_prior_claim(p_prior_claim_id, p_vendor_id, p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

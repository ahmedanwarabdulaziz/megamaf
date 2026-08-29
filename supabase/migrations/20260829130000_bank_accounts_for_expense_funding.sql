-- 20260829130000_bank_accounts_for_expense_funding.sql
--
-- Bug: an employee granted has_expense_funding_access (يمكنه اختيار مصدر
-- تمويل) is meant to be able to pick a bank account as the funding source
-- when recording an expense, but the bank dropdown showed nothing for them.
--
-- Root cause: app/(app)/expenses/page.tsx calls getBanks(), which reads
-- public.banks / public.v_bank_account_balances — both RLS-gated by
-- has_page_access('banks') only (0005_phase3_hardening.sql). An employee
-- with has_expense_funding_access but no separate 'banks' page grant gets
-- zero rows back, even though the app-layer check (canPickFundingSource)
-- correctly allowed them through.
--
-- Fix: a narrow, SECURITY DEFINER function exposing ONLY what the funding
-- dropdown needs (account + bank name) — deliberately NOT current_balance,
-- since an employee who can only pick a funding source, not manage
-- treasury, shouldn't see exact bank balances. This keeps the existing
-- 'banks' page RLS (which does expose balances) untouched and scoped to
-- users who actually have that page.

CREATE OR REPLACE FUNCTION public.get_bank_accounts_for_funding()
RETURNS TABLE (
  bank_account_id uuid,
  account_name    text,
  bank_id         uuid,
  bank_name       text
) AS $$
  SELECT ba.id, ba.account_name, b.id, b.name
  FROM public.bank_accounts ba
  JOIN public.banks b ON b.id = ba.bank_id
  WHERE public.is_super_admin()
     OR public.has_page_access('banks')
     OR COALESCE((SELECT has_expense_funding_access FROM public.employees WHERE id = public.current_employee_id()), false)
  ORDER BY b.name, ba.account_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.get_bank_accounts_for_funding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bank_accounts_for_funding() TO authenticated;

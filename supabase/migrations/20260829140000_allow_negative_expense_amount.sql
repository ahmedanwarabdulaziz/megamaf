-- 20260829140000_allow_negative_expense_amount.sql
--
-- Allow a negative expense amount to mean "returning money to custody" —
-- e.g. an employee spent less than the amount they'd already accounted for
-- and gives some back. v_employee_custody_balance already computes balance
-- as a plain SUM(disbursed) - SUM(approved expenses)
-- (0006_phase4_custody_expenses.sql), so a negative approved expense
-- correctly increases the employee's balance with no further changes needed
-- there.
--
-- Scope: only the plain custody path. A negative amount combined with
-- funding_type ('bank' / 'employee_custody') is rejected at the app layer
-- (lib/actions/expenses.ts validateFunding) — approve_expense() turns
-- funding_type into a real ledger_entries row with direction='out', which
-- only makes sense for money actually leaving that source, not a return.
-- Direct expenses (create_direct_expense, admin-only immediate bank
-- settlement) are untouched and still require a positive amount.

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_amount_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_amount_check CHECK (amount <> 0);

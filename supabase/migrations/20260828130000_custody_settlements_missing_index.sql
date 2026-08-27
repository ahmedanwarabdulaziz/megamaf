-- 20260828130000_custody_settlements_missing_index.sql
--
-- Found while investigating a "saving is getting slower" report. custody_settlements
-- has had a foreign key to ledger_entries (disbursement_ledger_id) since it was
-- created in 0006_phase4_custody_expenses.sql, but Postgres never auto-indexes FK
-- columns on the referencing side, and no migration ever added one. Every call to
-- settle_employee_custody() — triggered on essentially every expense approval,
-- custody disbursement, and loan approval — LEFT JOINs ledger_entries to this table
-- on that exact column, once per still-outstanding expense in the FIFO loop. Without
-- an index, each of those joins has to scan the whole company-wide table rather than
-- just the rows for the disbursements being matched, so the cost of every future
-- settle_employee_custody() call grows with total historical settlement rows, not
-- just this employee's own. Currently small (~500 rows) so not yet dramatic, but a
-- guaranteed slow creep as the table grows — this closes it before it compounds.
--
-- Also adds two adjacent indexes that shore up the rest of the same function:
-- expenses(employee_id, status) for its outer "still-unsettled" scan, and
-- custody_settlements(expense_id) for the settled_amount bookkeeping.

CREATE INDEX IF NOT EXISTS idx_custody_settlements_disbursement_ledger_id
  ON public.custody_settlements(disbursement_ledger_id);

CREATE INDEX IF NOT EXISTS idx_custody_settlements_expense_id
  ON public.custody_settlements(expense_id);

CREATE INDEX IF NOT EXISTS idx_expenses_employee_status
  ON public.expenses(employee_id, status);

# Phase 4 — Custody & Expenses (FIFO settlement)

## Goal
Let permitted employees log petty-cash/operating expenses (categorized, with photos) against projects; managers approve them; the treasury disburses custody money to employees; the system settles disbursements against approved expenses **FIFO**, supporting overspend and partial settlement.

## Prerequisites
Phases 2 (projects) and 3 (ledger).

## Database
- `expense_categories` (two levels), `expenses`, `custody_settlements` (`§5`).
- Custody disbursement = `ledger_entries` (`custody_disbursement`, in to `employee_id`, out of a bank account — modeled as a transfer pair: bank `out` + employee-custody `in`).
- View `v_employee_custody_balance` = Σ disbursements − Σ settled approved expenses (per employee).
- Add to employee config a **custody permission** flag (extend `employees` or a setting) gating who may log custody.

## Pages & components
- `(app)/expenses` (or `/custodies`) — employee entry: project (auto if only one), date (employee: today…−15 days; admin: any), amount, category→sub-category, notes, **camera/file attachments**, submit.
- Approval queue — manager reviews pending expenses, approve/reject (can-approve only).
- `(app)/treasury/custody` — disburse custody to an employee from a bank account.
- Employee custody statement — disbursements, expenses, running balance.
- `expense_categories` admin under settings (categories + sub-categories).

## Business rules
- **Date limit:** employees may backdate up to 15 days; admins unrestricted (server-enforced).
- **Approval:** only `can_approve`. On approve → expense becomes a project cost and eligible for settlement.
- **FIFO settlement:** when a disbursement is recorded, auto-allocate to the employee's **oldest unsettled approved expenses first**. Partial allowed (split across `custody_settlements` rows); `expenses.settled_amount = Σ allocations`.
- **Overspend:** approved expenses with no disbursement yet → custody balance negative (company owes employee); next disbursement settles oldest first.
- Worked example to verify: expenses item1=200, item2=300 (both approved, in that order); disbursement=400 → item1 settled 200 (full), item2 settled 200 (partial), item2 remaining=100.

## Acceptance criteria
- Employee with custody permission logs an expense with a photo; appears in approval queue; non-permitted employee cannot.
- Backdating 20 days is rejected for employee, allowed for admin.
- Disburse 1000 to an employee who has two approved 100 expenses → balance 800.
- The 200/300 + 400 example settles exactly as above (item2 remaining 100).
- Custody statement balances tie to `v_employee_custody_balance`; bank account reflects the disbursement outflow.
- `tsc` + `build` green.

## Guardrails
All cash via ledger; FIFO logic in SQL/server (deterministic, ordered by expense_date, id); audit on submit/approve/disburse; attachments via R2 keys with cached signed URLs.

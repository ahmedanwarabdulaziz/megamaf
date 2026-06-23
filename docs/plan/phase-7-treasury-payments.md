# Phase 7 — Treasury, Payments & Allocation

## Goal
The treasury cockpit: see all approved payables (vendor invoices, vendor claims, retention releases) and receivables (owner claims/schedule), pay/receive an amount from a bank account, then **manually allocate** that amount to specific documents — supporting partial settlement and overpayment (credit). Produce vendor/owner account statements.

## Prerequisites
Phases 4, 5, 6.

## Database
- `payment_allocations` (`§7`). A payment/receipt is a `ledger_entries` row (`vendor_payment` out / `owner_payment` in) with bank + counterparty set.
- Views: `v_vendor_account` (documents vs payments+allocations, with running balance and credit), `v_owner_account` similarly.
- Document "paid"/"remaining" derive from allocations, never stored ad-hoc.

## Pages & components
- `(app)/treasury` — tabs: **Payables** (vendor invoices/claims/retention) and **Receivables** (owner). Each row shows due / paid / remaining.
- **Pay** flow (calculator-style as Ahmed described): choose vendor + bank account + amount → the amount appears, then allocate it across that vendor's open documents (auto-suggest oldest-first but **editable**); leftover = vendor credit.
- **Receive** flow for owners: amount in → allocate to owner claims/schedule rows; leftover = owner credit (advance).
- Vendor/owner **account statement** screens (virtualized).

## Business rules
- Allocation total ≤ payment amount. Unallocated remainder is a tracked **credit** that can be allocated to future documents.
- Overpaying a document is allowed only via credit, not negative remaining.
- Retention release (from Phase 5) shows as a payable and is paid/allocated here.
- Custody uses FIFO (`custody_settlements`, Phase 4) — treasury custody disbursement screen lives in Phase 4; this phase is vendor/owner manual allocation.
- Every pay/receive posts to the ledger (affects bank balance immediately) and updates the party statement.

## Acceptance criteria
- Pay a vendor 1,000 against a 600 invoice + 300 claim → both allocated, 100 left as credit; bank balance drops 1,000.
- Partially pay a claim (allocate 450 of a 1,350 payable) → remaining 900 shown.
- Receive an owner installment, allocate to a scheduled row → schedule status becomes partial/paid; project income rises.
- Vendor/owner statements reconcile to ledger + documents exactly.
- `tsc` + `build` green.

## Guardrails
All cash via ledger; allocations are the only "paid" source; audit every payment/allocation; data grids; `Promise.all` for the treasury dashboards.

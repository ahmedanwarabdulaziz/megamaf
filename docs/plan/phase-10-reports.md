# Phase 10 — Reports & Dashboards

## Goal
Deliver all the reports on top of the views built in earlier phases. Reports are read-only, fast (view-backed), filterable by date/project, and exportable.

## Prerequisites
All money phases (3–9).

## Reports (all required at launch)
1. **Project financial position** — per node + rolled-up subtree: owner-billed income, received, costs (expenses + invoices + claims net of retention), retention held, paid, net, receivable/payable. (`v_project_financial_position`)
2. **Bank account statement** — running balance per account. (`v_bank_statement`)
3. **Employee custody statement** — disbursements vs approved expenses, balance. (`v_employee_custody_balance`)
4. **Vendor/contractor account statement** — documents vs payments, remaining/credit. (`v_vendor_account`)
5. **Owner account statement** — owner claims/schedule vs receipts. (`v_owner_account`)
6. **Deposits & profit schedule** — expected vs collected.
7. **Audit log** — full who/what/when (viewer also in Phase 11).
8. **Company-wide P&L summary** — income, costs, retention, cash position across all nodes + bank totals.

## Pages & components
- `(app)/reports` hub linking each report; each report = filters (date range, project, party) + virtualized grid + totals + CSV/print export.
- A home **dashboard** with key cards: cash across banks, pending approvals count, project positions snapshot, upcoming owner installments & deposit payouts.

## Business rules
- Every figure traces to a single view (no client-side re-summing). Reports must reconcile with the underlying statements.
- Date filters are inclusive; subtree rollups sum children into parents.

## Acceptance criteria
- Each report renders from its view and reconciles with source screens (e.g. P&L cash position == Σ bank balances).
- 50k-row statements stay smooth (virtualized + server paging) and export to CSV.
- Dashboard cards match the detailed reports.
- `tsc` + `build` green.

## Guardrails
Views only; `Promise.all` for dashboard cards; cache where possible; respect RLS/project scope in every report.

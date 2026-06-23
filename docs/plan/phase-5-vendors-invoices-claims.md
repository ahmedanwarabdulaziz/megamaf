# Phase 5 — Vendors: Invoices & Progress Claims

## Goal
Manage vendors/contractors and the two ways they bill the company — **Invoices** (itemized, optional tax/discount, optional receipt into a warehouse) and **Progress Claims / مستخلصات** (cumulative quantities, disbursement %, retention, carried across claims). Both go through approval and then become payable in the treasury (Phase 7). This phase also builds the **shared claims engine** reused by owner claims (Phase 6).

## Prerequisites
Phases 2, 3.

## Database
- `vendors`, `vendor_project_access` (`§6`).
- `invoices`, `invoice_items` (`§6`) with computed `subtotal/discount_amount/tax_amount/total` (DB triggers/generated).
- `claims`, `claim_items`, `retention_releases` (`§6`) — `claim_type='vendor'` here.
- View `v_claim_totals` (per-claim due/retained/paid/remaining using the exact formula).

## Pages & components
- `(app)/vendors` — list + add/edit (kind vendor/contractor, all_projects toggle, allowed projects).
- `(app)/invoices` — create invoice: vendor, project, lines (description, qty, unit_price, line_total, optional warehouse_id), tax toggle+rate, discount rate; totals auto. Attachments. Approval queue.
- `(app)/claims` — create claim for a vendor on a project: pulls prior approved claim's items as `previous_qty`, lets user set `current_qty`, `disbursement_pct` (editable per claim — deal can change), add new items; live totals panel (due this claim / retained to date / paid / remaining). Attachments. Approval queue.

## Business rules
- **Invoice totals:** `subtotal=Σ line_total`; `discount_amount=subtotal*discount_rate`; `tax_amount=(subtotal−discount_amount)*tax_rate` if tax enabled; `total=subtotal−discount_amount+tax_amount`. Tax/discount optional.
- **Claim math (exact, per `01_DATA_MODEL.md §6`):** per `item_ref`: `cumulative_qty=previous_qty+current_qty`; `line_total=cumulative_qty*unit_price`; `cumulative_payable=line_total*disbursement_pct`; `cumulative_retained=line_total*(1−disbursement_pct)`. `total_due_this_claim = Σcumulative_payable(this) − Σcumulative_payable(prior)`. Tax optional on the net.
- `unit_price` is fixed from an item's first appearance; later claims cannot change it (only quantities and pct).
- `previous_qty` auto-derives from prior **approved** claims for the same `item_ref`.
- **Retention release** is a Phase-7 payment concern but the action/record lives here (`retention_releases`); admin may release anytime and change `disbursement_pct` on new claims.
- Invoice item with `warehouse_id` will create stock movement in Phase 8 (record the link now).

## Acceptance criteria
- Vendor restricted to one project cannot be billed on another.
- Invoice with tax 14% + 5% discount computes totals correctly; tax-off invoice has tax_amount 0.
- Claim #1: marble qty 100 @10, 90% → line_total 1000, payable 900, retained 100, due-this-claim 900.
- Claim #2: same item previous 100, current 50 → cumulative 150, line_total **1500**, payable 1350, retained 150, **due-this-claim = 1350−900 = 450**. Adding a new item works.
- Approval gates payability; `v_claim_totals` matches the hand calculation.
- `tsc` + `build` green.

## Guardrails
Money math in Postgres; data grid for lists; audit on create/approve/release; attachments via R2.

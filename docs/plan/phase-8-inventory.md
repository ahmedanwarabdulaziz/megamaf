# Phase 8 — Inventory & Warehouses

## Goal
Full inventory: warehouses per node (main company + projects), receiving items from vendor invoices, stock-on-hand tracking, transfers (main warehouse → project warehouse), issues out (including owner-claim lines that consume stock), and adjustments.

## Prerequisites
Phases 2 (nodes), 5 (invoices), and 6 (owner claims, for stock-issue lines).

## Database
- `warehouses`, `inventory_items` (catalog), `stock_movements` (`§8`) with index `(warehouse_id, item_id)`.
- View `v_stock_on_hand` = per warehouse+item, Σ in-types − Σ out-types (with weighted value optional).
- Wire links recorded earlier: invoice_item.warehouse_id → `in_invoice`; owner claim_item.is_stock_issue → `issue`.

## Pages & components
- `(app)/warehouses` — warehouses list; per-warehouse stock-on-hand grid.
- Receive: from an approved invoice with warehouse lines, generate `in_invoice` movements (qty, unit_price).
- Transfer modal: from-warehouse → to-warehouse, item, qty → paired `transfer_out`/`transfer_in` (main company main warehouse → project warehouse is the key flow).
- Issue / adjust modals.

## Business rules
- A node can have one or more warehouses; main company has a "main warehouse".
- Receiving is tied to an **approved** invoice line marked for a warehouse.
- Transfers must conserve quantity (out qty == in qty), and cannot drive stock negative unless adjustment.
- Owner claim line flagged `is_stock_issue` issues that item from its `warehouse_id` on approval.

## Acceptance criteria
- Approve an invoice with 2 warehouse lines → stock-on-hand rises correctly.
- Transfer 10 units main→project: main −10, project +10, net 0.
- Owner claim with a stock-issue line reduces that warehouse's stock on approval.
- Stock-on-hand never silently goes negative (blocked or explicit adjustment).
- `tsc` + `build` green.

## Guardrails
Movements are append-only (corrections via `adjust`), aggregation in SQL view, audit on every movement, data grid for stock.

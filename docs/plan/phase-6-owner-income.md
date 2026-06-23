# Phase 6 — Owner Claims & Project Income

## Goal
Bill each project's **owner** using the same claims engine as contractors (مستخلص المالك), track an **expected-payments schedule**, and record actual owner payments as the project's income. This is the revenue side that makes a project's financial position meaningful.

## Prerequisites
Phases 2, 3, 5 (reuses the claims engine).

## Database
- Reuse `claims`/`claim_items` with `claim_type='owner'`, `party_id = project_owners.id`.
- `owner_payment_schedule` (`§7`): expected installments (due_date, expected_amount, method, status).
- Owner claim items may set `is_stock_issue=true` + `warehouse_id` → triggers a stock issue in Phase 8.
- Extend `v_project_financial_position`: income = Σ owner payments received (+ optionally owner-billed); cost = approved expenses + approved invoices + approved vendor claims (net of retention); net + retention held + receivable/payable.

## Pages & components
- On `(app)/projects/[id]` — **Owner** tab: owner info, owner claims (create like vendor claim), expected-payments schedule (add rows), received-to-date, remaining.
- Owner claim create screen = same UI as vendor claim, `claim_type='owner'`, with the optional "issue from warehouse" flag per line.
- Project financial-position tab now shows real numbers (income vs cost vs retention vs net).

## Business rules
- Owner claim math identical to vendor claim (cumulative qty × price, disbursement %, optional tax, retention to date).
- Expected schedule is for tracking only; actual receipts are treasury `owner_payment` (in) allocated to schedule rows/owner claims (Phase 7). Schedule row status: expected → partial → paid based on allocations.
- Main company has **no income** → no owner claims; only expenses/obligations (enforce: cannot create owner claim on the main-company node).

## Acceptance criteria
- Create an owner claim on a project mirroring the vendor-claim example (same numbers).
- Add an expected-payment schedule (3 installments); statuses update as payments are allocated in Phase 7.
- Project financial position reflects owner-billed income and costs; main company shows costs only.
- Cannot create an owner claim on the main company.
- `tsc` + `build` green.

## Guardrails
Reuse, don't fork, the claims engine; money math in SQL; audit + attachments; data grid.

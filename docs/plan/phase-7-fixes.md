# Phase 7 — Required Fixes (do before Phase 8)

Implement as a new append-only migration **`supabase/migrations/0013_phase7_hardening.sql`**. Do **not** edit 0012. Phase 7 works and your "paid/remaining" boxes are now live; these close money-integrity gaps in the payment/allocation logic.

What's already good: polymorphic `payment_allocations` linked to `ledger_entries`; `record_vendor_payment`/`record_owner_receipt` are atomic, audited, validate Σallocations ≤ payment, and the owner receipt updates schedule status; `v_claim_paid`/`v_invoice_paid`/`v_vendor_account`/`v_owner_account` all `security_invoker`.

---

## FIX 1 — 🟠 Per-project "cash paid / received" is always 0
**Problem:** `record_vendor_payment`/`record_owner_receipt` insert the ledger row **without `project_id`** (a payment can span documents in several projects, so it's null). But `v_project_financial_position` computes `total_paid`/`total_received` as `SUM(ledger_entries.amount) WHERE project_id = p.id` — which never matches, so **both columns are always 0**.
**Do:** derive project cash from **allocations**, not the ledger's `project_id`:
- `total_paid(project)` = Σ `payment_allocations.allocated_amount` where the **target document's `project_id`** = the project (join allocations → invoice/claim/retention to get `project_id`, for vendor payments).
- `total_received(project)` = same via owner allocations (claim / owner_schedule → `project_id`).
Rewrite those two columns in `v_project_financial_position` accordingly.

## FIX 2 — 🟠 Block over-allocating a single document
**Problem:** the RPCs check Σallocations ≤ payment, but **not** that each allocation ≤ that document's **remaining due**. You can allocate 1,000 to a 600 invoice, making its "paid" exceed "due" and "المتبقي" go negative. The data model says overpayment is allowed only as **party credit**, never as negative remaining on a document.
**Do:** in both RPCs, for each allocation compute the target's remaining due (`amount_due − already_allocated`, using the `v_*_paid`/totals views) and **reject if the allocation exceeds it**. Excess must stay unallocated (party credit), not be forced onto the document.

## FIX 3 — 🟠 Verify allocation targets belong to the party being paid
**Problem:** `record_vendor_payment(p_vendor_id, allocations)` doesn't check that each `target_id` actually belongs to `p_vendor_id`. You could pay Vendor A but allocate to Vendor B's invoice/claim. Same for owners.
**Do:** for each allocation, verify the target document's `vendor_id`/owner `party_id` = the party being paid (and `target_type` is valid for that party). Reject otherwise.

## FIX 4 — 🟠 Gate payment RPCs by treasury access + project
**Problem:** both RPCs only check `can_approve` (there's even a `-- TODO has_page_access('treasury')`). A limited approver could pay against any project.
**Do:** require `has_page_access('treasury')` or super admin, **and** `has_project_access` for each allocated target's project. (Consistent with the scoping rules from earlier phases.)

## FIX 5 — 🟡 Scope `payment_allocations` SELECT
Currently `USING (true)` — every authenticated user sees all allocations/amounts. Scope it (e.g. via the target document's project access, or super-admin/treasury). Low priority since amounts also surface through the scoped account views.

## FIX 6 — 🟡 Performance of `v_project_financial_position`
It runs a correlated `SELECT … FROM v_claim_totals WHERE claim_id = c.id` per claim row under a `GROUP BY`. Fine now; before the reports phase (10) refactor to a single join against `v_claim_totals` to avoid repeated evaluation.

---
**After applying:** `npx tsc --noEmit` + `next build` green. Re-test:
- Pay a vendor 1,000 against a 600 invoice + 300 claim → 600 and 300 allocate, **100 stays as credit** (not forced onto a document); both docs show paid = due, remaining 0.
- Try to allocate 700 to the 600 invoice → rejected.
- Try to allocate a payment for Vendor A onto Vendor B's invoice → rejected.
- Project financial position now shows **real** total_paid / total_received (not 0), reconciling with the bank statement.
- A treasury user limited to Project A can't pay Project B's documents.

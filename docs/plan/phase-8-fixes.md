# Phase 8 — Required Fixes (do before Phase 9)

Implement as a new append-only migration **`supabase/migrations/0015_phase8_hardening.sql`**. Do **not** edit 0014. Inventory itself is good; the headline is a **regression** in the approve RPCs that 0014 introduced.

What's good: `warehouses` / `inventory_items` / `stock_movements`; `v_stock_on_hand` sums signed movements (`security_invoker`); invoice approval makes `in_invoice` receipts; owner-claim stock-issue lines issue on approval **with a negative-stock guard**; transfers are paired and check source stock.

---

## FIX 1 — 🔴 `approve_invoice` / `approve_claim` lost project-access check + audit (regression)
**Problem:** 0014 redefined both RPCs to add stock-movement generation, but in doing so it **dropped the Phase 5 hardening that 0009 had added** — the `has_project_access(project_id)` check and the `audit_log` insert. The live functions now only check `can_approve`, so:
- a project-limited approver can again approve **any** project's invoice/claim (the approver-scoping hole reopened), and
- invoice/claim approvals are **no longer audited**.
**Do:** redefine both RPCs to **keep the new stock-movement logic AND restore**:
- `SELECT … project_id, status INTO …` then `IF NOT FOUND THEN RAISE …`.
- `IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized on this project'; END IF;`
- the `INSERT INTO public.audit_log (… 'approve' …)` row.
Result: approvals are project-scoped and audited **and** still generate stock movements.

## FIX 2 — 🟠 `record_stock_transfer` has no authorization check
**Problem:** it's `SECURITY DEFINER` (bypasses RLS) with **no permission gate** — any authenticated user can move stock between warehouses.
**Do:** at the top, require `public.is_super_admin()` OR `has_page_access('inventory')` (or whatever the warehouses page slug is), **and** `has_project_access` for **both** the source and destination warehouses' projects (main-company warehouse = `project_id IS NULL`, allow for admins/inventory access). Also reject `p_from_warehouse_id = p_to_warehouse_id`.

## FIX 3 — 🟡 Add `set_updated_at` triggers
`warehouses` and `inventory_items` both have `updated_at` but no trigger (conventions §3). Attach `set_updated_at` to each. (`stock_movements` is append-only — no `updated_at` needed.)

---
**After applying:** `npx tsc --noEmit` + `next build` green. Re-test:
- Approving an invoice/claim still creates the right stock movements, **and** now: a project-limited approver is rejected on another project's document, and an `audit_log` row appears for every approval.
- A non-privileged user cannot call the stock transfer; a transfer to the same warehouse is rejected; transfers still conserve quantity and can't drive stock negative.

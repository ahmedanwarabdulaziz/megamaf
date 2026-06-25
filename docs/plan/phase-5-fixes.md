# Phase 5 — Required Fixes (do before Phase 6)

Implement as a new append-only migration **`supabase/migrations/0009_phase5_hardening.sql`** plus the noted action/UI changes. Do **not** edit 0008. Phase 6 (owner claims) reuses this exact engine, so these must land first.

---

## FIX 1 — 🔴 Separate "previously certified" from "actually paid" (the bug Ahmed spotted)
**Where:** `components/claims/create-claim-form.tsx` (~line 297) and the claim view.
**Problem:** the summary subtracts `priorCumulativePayable` (the prior approved claim's **cumulative certified** value) under the label **"يخصم ما سبق صرفه"** ("deduct what was previously *paid*"). Nothing was paid — this is the amount **previously certified/claimed**, subtracted only to avoid double-billing the same work. The label makes it look like claim #1 was settled when no money moved. **Ahmed wants a box that shows what was actually paid.**

**Decision (Ahmed):** keep the phase order. Add the real "paid/remaining" boxes now; they correctly show **0** until Phase 7 records actual payments. Do **not** reorder.

**Do:**
1. **Relabel** the existing subtraction line → **"يُخصم: إجمالي المستخلصات السابقة المعتمدة"** (or "ما سبق المطالبة به"). Never "صرفه". This line is the certification mechanism, not a payment.
2. **Add two new, clearly separate boxes** on the claim view + vendor statement (and a read-only preview on create):
   - **"المدفوع فعلياً"** = SUM of actual treasury payments allocated to this contractor/claim, sourced **only** from `ledger_entries` (`vendor_payment`) + `payment_allocations` (built in Phase 7). **Never** derive it from prior claims.
   - **"المتبقي"** = (cumulative certified payable to date) − (المدفوع فعلياً).
3. **Provide the data source now so Phase 7 just plugs in:** create `v_claim_paid` (and/or extend `v_claim_totals`) as a view that LEFT JOINs `payment_allocations` and returns `paid = COALESCE(SUM(allocated), 0)`. Since `payment_allocations` doesn't exist until Phase 7, either (a) create a minimal `payment_allocations` table now (empty) so the view compiles and returns 0, or (b) hardcode `paid = 0` in the view with a `-- TODO Phase 7` and swap the source in Phase 7. Prefer (a). The view must be `security_invoker = true`.
4. Result today: a brand-new claim shows **المدفوع فعلياً = 0** and **المتبقي = full certified amount** — truthful, and it fills in automatically once Phase 7 payments land.

## FIX 2 — 🔴 Derive `previous_qty` and lock `unit_price` server-side
**Problem:** `createClaim` trusts the client's `previous_qty` and `unit_price` for carried items. Wrong/tampered values corrupt the cumulative payment math.
**Do:** in the claim create path (action or a SECURITY DEFINER RPC), for each `item_ref` that exists in prior **approved** claims for the same party+project+claim_type: compute `previous_qty = Σ current_qty` across those prior claims, and **force `unit_price`** to the item's first-appearance price (ignore client values). New items get a fresh `item_ref` and may set price freely. The client form may still prefill for UX, but the server must recompute authoritatively.

## FIX 3 — 🔴 Add `security_invoker = true` to `v_claim_totals`
**Problem:** the view lacks `security_invoker`, so it runs as owner and bypasses RLS — claim totals leak across projects.
**Do:** recreate it `WITH (security_invoker = true)` (every view must have this).

## FIX 4 — 🟠 Audit invoice/claim approvals & rejections
**Problem:** `approve_invoice`/`reject_invoice`/`approve_claim`/`reject_claim` update status with **no `audit_log` write** (the expense-approve RPC audits; these don't).
**Do:** insert an `audit_log` row (`action='approve'`/`'reject'`) in all four RPCs.

## FIX 5 — 🟠 Check project access inside approve/reject RPCs
**Problem:** the RPCs only check `can_approve`, so a project-limited approver could approve any project's invoice/claim by ID (SECURITY DEFINER bypasses the SELECT scope).
**Do:** add `has_project_access(<doc>.project_id)` (super admins bypass) — consistent with the Phase 4 approver-scoping rule.

## FIX 6 — 🟠 Enforce vendor↔project restriction on create
**Problem:** an invoice/claim can be created for a vendor not allowed on that project.
**Do:** in `createInvoice`/`createClaim` (and/or RLS `WITH CHECK`), require the vendor be `all_projects = true` **or** have a `vendor_project_access` row for `project_id`. (Acceptance: a vendor restricted to one project can't be billed on another.)

## FIX 7 — 🟡 Gate & audit retention releases
**Problem:** `retention_releases` inserts are open to anyone with project access and aren't audited.
**Do:** route through a SECURITY DEFINER RPC that requires super-admin or `can_approve` + project access, and writes an `audit_log` row (it creates a payable).

## FIX 8 — 🟡 Refactor `v_claim_totals` performance
The same correlated "prior cumulative payable" subquery is repeated 4× per row. Compute it once via a `LATERAL` join or an extra CTE.

---
**After applying:** `npx tsc --noEmit` + `next build` green. Re-test:
- Claim #2 summary reads "يُخصم: المستخلصات السابقة المعتمدة" (not "صرفه"); with no Phase-7 payments, "مدفوع" = 0.
- Editing the client payload can't change a carried item's `previous_qty`/`unit_price` (server recomputes).
- A project-limited approver can't approve another project's claim; all approvals appear in the audit log.
- A vendor restricted to Project A can't be invoiced/claimed on Project B.
- Claim math still matches: claim 1 = 900 due; claim 2 (cumulative 1350 − prior 900) = 450.

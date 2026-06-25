# Phase 6 — Required Fixes (do before Phase 7)

Implement as a new append-only migration **`supabase/migrations/0011_phase6_hardening.sql`** plus the noted action change. Do **not** edit earlier migrations. Phase 6 is mostly correct; these close one real bug and two integrity/audit gaps.

Context: Phase 5 hardening (0009) landed well — `v_claim_totals` now has `security_invoker`, the claim engine derives `previous_qty` / locks `unit_price` server-side, approvals are project-scoped + audited, and the `payment_allocations` + `v_claim_paid` "paid box" infra exists. Phase 6 reuses all of that correctly.

---

## FIX 1 — 🔴 `release_retention` RPC is broken (column mismatch)
**Problem:** the `release_retention` RPC (added in 0009) inserts into `retention_releases` using columns that **don't exist** on the table and omits the required NOT NULL ones. The table (0008) is:
`(id, claim_type, party_id, project_id, amount, released_by, released_at, notes, created_at)`
but the RPC inserts `(claim_id, release_date, release_amount, notes, status, created_by)`. Calling it will throw `column "claim_id" does not exist`. Retention release is therefore completely broken.
**Do:** rewrite the RPC's INSERT to match the real table — derive `claim_type`, `party_id`, `project_id` from the claim being released, and use the real column names:
```sql
-- inside release_retention, after the permission checks and SELECT of the claim:
INSERT INTO public.retention_releases (claim_type, party_id, project_id, amount, released_by, notes)
VALUES (v_claim_type, v_party_id, v_project_id, p_amount, public.current_employee_id(), p_notes)
RETURNING id INTO v_retention_id;
```
(Add `v_claim_type`/`v_party_id` to the `SELECT ... INTO` that already reads `project_id`/`status` from the claim.) Keep the audit insert.

## FIX 2 — 🟠 Validate the owner-claim party = the project's owner
**Problem:** `createClaim` validates the party for **vendor** claims (vendor allowed on project) but does **no** check for **owner** claims — `party_id` could be any UUID. An owner claim must bill the project's actual owner.
**Do:** in `createClaim`, when `claim_type = 'owner'`, load `projects.owner_id` for `project_id` and require `party_id = owner_id` (and that the project has an owner). Reject otherwise. Optionally enforce in the DB too (a trigger that checks `claims.party_id = projects.owner_id` when `claim_type='owner'`).

## FIX 3 — 🟠 Audit owner_payment_schedule writes
**Problem:** `addPaymentScheduleRow` / `deletePaymentScheduleRow` insert/delete with no `audit_log` entry (every write must be audited).
**Do:** call `logAudit` (or route through a SECURITY DEFINER RPC) on add and delete, recording the schedule row and project.

## FIX 4 — 🟡 Add `set_updated_at` trigger to `owner_payment_schedule`
It has an `updated_at` column but no trigger (conventions §3). Attach `set_updated_at`.

## FIX 5 — 🟡 Project financial position will need the cash side (note for Phase 7)
`v_project_financial_position` currently shows **billed** income (owner claims) − **billed** cost (invoices + vendor claims), net of retention via payable amounts. It does **not** yet surface: retention held, **actually received from owner**, **actually paid to vendors**, or receivable/payable. Those depend on real payments (Phase 7 / `payment_allocations`). When Phase 7 lands, extend this view to add `total_received`, `total_paid`, `retention_held`, and `net_receivable` — consistent with the "show actual paid" decision from Phase 5.

---
**After applying:** `npx tsc --noEmit` + `next build` green. Re-test:
- Releasing retention on an approved claim succeeds and writes a `retention_releases` row + audit (no column error).
- An owner claim can only be created with `party_id` = that project's owner; a wrong party is rejected; owner claims still can't be created on the main company.
- Adding/removing an owner payment-schedule row appears in the audit log.
- Project financial position still reconciles: income (owner) − expenses (invoices + vendor claims).

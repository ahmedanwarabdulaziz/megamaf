# Phase 3 — Required Fixes (do before Phase 4)

Implement as a new append-only migration **`supabase/migrations/0005_phase3_hardening.sql`** plus the noted action/UI changes. Do **not** edit 0004. Phase 3 schema and views are good; these close money-integrity and access gaps.

Decisions from Ahmed: **ledger visibility must be scoped to the user's access (not everything)**; **the ledger is append-only/immutable — corrections via reversing entries**; **bank→bank transfers stay** (bank→project deferred).

---

## FIX 1 — 🔴 Make the ledger append-only (immutable)
**Problem:** super admins can `UPDATE`/`DELETE` `ledger_entries`, weakening the single source of truth.
**Do:**
- Drop the UPDATE and DELETE policies on `ledger_entries`. No role may edit or delete a ledger row.
- Corrections happen by **reversing entries**: add a `reverse_ledger_entry(p_entry_id uuid, p_reason text)` `SECURITY DEFINER` RPC (super-admin only) that inserts a new row with the opposite `direction`, same `amount`/`bank_account_id`/`project_id`, `category` unchanged (or a `reversal` marker), `source_type='reversal'`, `source_id=p_entry_id`, and the reason in `memo`. Audit it.
- Because the ledger is now immutable, **transfers must not rely on delete-rollback** — see FIX 2.

## FIX 2 — 🔴 Atomic money writes via RPC (no orphan/unbalanced rows)
**Problem:** account+opening-row and the transfer pair are separate inserts; the transfer's manual `delete` rollback can be blocked by RLS, leaving an unbalanced ledger.
**Do — replace the multi-insert TS logic with `SECURITY DEFINER` Postgres functions (one transaction each):**
- `create_bank_account(...)` → inserts the account **and** its opening-balance ledger row atomically. Handle edge cases: if `opening_balance = 0`, insert **no** ledger row; if **negative**, insert the opening row as `direction='out'` with `amount = abs(value)` (keeps the `amount > 0` constraint and represents overdrafts correctly).
- `create_transfer(p_from, p_to, p_amount, p_date, p_memo)` → inserts the paired `transfer_out` + `transfer_in` atomically (both or neither). Keep the same-account guard. **Bank→bank only for now.**
- Each RPC checks permission internally (see FIX 3) and writes the audit row. The server actions just call the RPC.

## FIX 3 — 🔴 Gate ledger writes by permission
**Problem:** `ledger_entries` INSERT policy is `WITH CHECK (true)` and actions have no permission gate — any authenticated user can post interest/deductions/transfers/arbitrary rows.
**Do:**
- Add helper `public.has_page_access(p_slug text) returns boolean` (true if super admin, or a matching `employee_page_access` row).
- Restrict the INSERT policy so direct inserts aren't open: require `public.is_super_admin()` **or** that the entry is created through the SECURITY DEFINER RPCs. Simplest: lock the table's direct INSERT to super admin, and route all legitimate writes (banks, and later custody/vendors) through SECURITY DEFINER RPCs that enforce the right page/project permission. Bank/adjustment/transfer writes require `has_page_access('banks')`.

## FIX 4 — 🟠 Scope ledger SELECT to the user's access
**Problem:** SELECT is `USING (true)` — every user sees the whole company ledger.
**Do:** replace with:
```sql
USING (
  public.is_super_admin()
  OR (bank_account_id IS NOT NULL AND public.has_page_access('banks'))
  OR (project_id IS NOT NULL AND public.has_project_access(project_id))
)
```
So: bank statements are visible to users with the **banks** page; project-attributed entries are visible to users granted that **project** (cascading via the recursive `has_project_access`); super admins see all. Keep `banks`/`bank_accounts` SELECT company-wide for users with banks access (tighten those to `has_page_access('banks')` rather than `true`).

## FIX 5 — 🟠 Add `set_updated_at` triggers
Attach the existing `set_updated_at` trigger to `banks` and `bank_accounts` (per conventions §3). `ledger_entries` is immutable now, so its `updated_at` is vestigial — you may drop that column.

## FIX 6 — 🟠 Actually virtualize the bank statement
**Problem:** the statement page only has a comment about virtualization; no real virtual list.
**Do:** implement `@tanstack/react-virtual` (`useVirtualizer`) over `v_bank_statement` with **server-side paging**, reading the precomputed `running_balance`. Verify smooth scroll with ~5,000 seeded rows.

---
**After applying:** run the migration; `npx tsc --noEmit` + `next build` green; re-test: create account (0, positive, negative opening), interest/deduction, bank→bank transfer (confirm both balances move and net change is 0), and confirm a standard user limited to one project sees only that project's ledger entries — not the whole company. Confirm no role can UPDATE/DELETE a ledger row; corrections only via `reverse_ledger_entry`.

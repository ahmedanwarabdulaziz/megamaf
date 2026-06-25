# Phase 4 — Required Fixes (do before Phase 5)

Implement as a new append-only migration **`supabase/migrations/0007_phase4_hardening.sql`** plus the noted changes in `lib/actions/expenses.ts` and the expense form. Do **not** edit 0006. Phase 4 is otherwise correct (FIFO settlement verified) — these close access-control and input gaps.

Decisions from Ahmed: **approvers see only expenses in projects they're granted** (super admins see all); **employees cannot log a future-dated expense** (today back to 15 days only).

---

## FIX 1 — 🔴 Enforce project access on expense create (RLS + action)
**Problem:** `createExpense` inserts the form's `project_id` with no access check, and the RLS insert policy only checks self + `has_custody_access`. An employee could file an expense against a project they aren't granted.
**Do (migration):** replace the expenses INSERT policy so it also requires project access:
```sql
DROP POLICY IF EXISTS "Expenses insertable by self if custody access" ON public.expenses;
CREATE POLICY "Expenses insert scoped" ON public.expenses
  FOR INSERT TO authenticated WITH CHECK (
    employee_id = public.current_employee_id()
    AND (SELECT has_custody_access FROM public.employees WHERE id = public.current_employee_id())
    AND public.has_project_access(project_id)
  );
```
**Do (action):** in `createExpense`, before insert, verify access for a clean error message (don't just rely on RLS):
```ts
const { data: ok } = await supabase.rpc('has_project_access', { p_project_id: parsed.data.project_id });
if (!ok) throw new Error('لا تملك صلاحية على هذا المشروع');
```

## FIX 2 — 🟠 Scope approver expense visibility to granted projects (decided: YES)
**Problem:** any `can_approve` user currently sees **all** expenses across **all** projects.
**Do (migration):** replace the expenses SELECT policy:
```sql
DROP POLICY IF EXISTS "Expenses viewable by creator or approvers" ON public.expenses;
CREATE POLICY "Expenses select scoped" ON public.expenses
  FOR SELECT TO authenticated USING (
    employee_id = public.current_employee_id()
    OR public.is_super_admin()
    OR (
      (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id())
      AND public.has_project_access(project_id)
    )
  );
```
So: creators always see their own; super admins see all; approvers see only expenses in projects they're granted (cascades via the recursive `has_project_access`).

## FIX 3 — 🟡 Block future-dated expenses (decided: YES)
**Problem:** the 15-day rule blocks only dates too far **back**; a non-admin can still pick a **future** date (the day-diff goes negative and passes).
**Do (action):** in `createExpense`, after computing `diffDays`, add for non-super-admins:
```ts
if (!employeeData.is_super_admin && diffDays < 0) {
  throw new Error('لا يمكن تسجيل مصروف بتاريخ مستقبلي');
}
```
(Keep the existing `diffDays > 15` back-date block.)

## FIX 4 — 🟡 Support multiple attachments per expense
**Problem:** `createExpense` takes a single `attachment_url`; the spec calls for one **or more** photos/files (camera or upload).
**Do:** let the form upload multiple files to R2 and submit several keys; in the action read them all (`formData.getAll('attachment_url')`) and insert one `attachments` row per key (entity_type `expense`). Keep using the R2 key only.

---
**After applying:** run the migration; `npx tsc --noEmit` + `next build` green. Re-test:
- An employee granted only Project A **cannot** create or see an expense on Project B (blocked by RLS + action).
- An approver granted only Project A sees Project A's pending expenses but **not** Project B's; a super admin sees all.
- A non-admin is blocked from a future date and from a date older than 15 days.
- An expense can carry several photos, all visible on the expense.
- FIFO settlement and custody balances still reconcile (unchanged).

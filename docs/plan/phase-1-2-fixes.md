# Phase 1 & 2 — Required Fixes (do before Phase 3)

Implement these as a new append-only migration **`supabase/migrations/0003_phase1_hardening.sql`** plus the noted code changes. Do **not** edit `0001`/`0002`. Decision on access scope: **project access CASCADES to the subtree** (a user granted a parent node sees its branches/phases).

---

## FIX 1 — 🔴 Stop exposing PIN hashes (security)
**Problem:** `employees` has `FOR SELECT USING (true)`, and RLS is row-level, so any authenticated user can read `pin_hash` for everyone. A 6-digit PIN hash is crackable offline.
**Do:**
- Create `public.employee_secrets (employee_id uuid PK references employees(id) on delete cascade, pin_hash text, failed_pin_attempts int not null default 0, locked_until timestamptz, updated_at timestamptz default now())`.
- Copy existing values from `employees` into it, then `ALTER TABLE public.employees DROP COLUMN pin_hash, DROP COLUMN failed_pin_attempts, DROP COLUMN locked_until;`
- Enable RLS on `employee_secrets` with **no policies for `authenticated`** (so only the service role can read/write it). All PIN verification + lockout already runs server-side with the service-role client — point it at `employee_secrets`.
- Update `lib/auth/*` and any employee create/edit code to write PIN + lockout fields to `employee_secrets`.
**Accept:** as a standard user, `select pin_hash from employees` and `select * from employee_secrets` both return nothing/error; login + lockout still work.

## FIX 2 — 🔴 Make views respect RLS (security)
**Problem:** `v_project_financial_position` runs as owner and ignores the caller's project scope (leaks once real data exists).
**Do:** `ALTER VIEW public.v_project_financial_position SET (security_invoker = true);` and make `security_invoker = true` the **standard for every view from now on** (note it in conventions).
**Accept:** a standard user querying the view sees only their accessible projects.

## FIX 3 — 🟠 Add missing indexes (performance)
**Problem:** `current_employee_id()` filters `employees.auth_user_id = auth.uid()` on every RLS check with no index (seq scan).
**Do:** add indexes:
- `idx_employees_auth_user_id` on `employees(auth_user_id)`
- `idx_projects_parent_id` on `projects(parent_id)`
- `idx_projects_owner_id` on `projects(owner_id)`
- `idx_epa_project_id` on `employee_project_access(project_id)`
- `idx_audit_employee_id` on `audit_log(employee_id)`
- `idx_attachments_uploaded_by` on `attachments(uploaded_by)`
**Accept:** `explain` on an RLS-filtered employees lookup uses the index.

## FIX 4 — 🟠 Protect the Main Company at the DB level (correctness)
**Problem:** nothing in the DB stops closing/deleting the `is_main` row.
**Do:** add a `BEFORE UPDATE OR DELETE` trigger on `projects` that raises an exception if `OLD.is_main = true` and (the row is being deleted, or `NEW.status = 'closed'`).
**Accept:** `update projects set status='closed' where is_main` and `delete from projects where is_main` both error.

## FIX 5 — 🟠 Auto-maintain `updated_at` (correctness)
**Problem:** `updated_at` columns exist but never change.
**Do:** create `public.set_updated_at()` trigger fn (`NEW.updated_at = now(); return NEW;`) and attach a `BEFORE UPDATE` trigger to every table with `updated_at` (employees, projects, project_owners, app_settings, user_credentials, employee_secrets, …).
**Accept:** updating a row bumps `updated_at`.

## FIX 6 — 🟢 Cascade project access to the subtree (decided: YES)
**Problem:** `has_project_access` is exact-match; a parent grant doesn't reveal branches/phases.
**Do:** replace the function so access is granted if the target **or any ancestor** is in the user's access list:
```sql
CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id uuid) RETURNS boolean AS $$
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id FROM public.projects WHERE id = p_project_id
    UNION ALL
    SELECT p.id, p.parent_id FROM public.projects p
    JOIN ancestors a ON p.id = a.parent_id
  )
  SELECT EXISTS (
    SELECT 1 FROM public.employee_project_access epa
    WHERE epa.employee_id = public.current_employee_id()
      AND epa.project_id IN (SELECT id FROM ancestors)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```
**Accept:** grant a user only the parent project → they can read its branches and phases; revoke → they lose all.

## FIX 7 — 🟡 (optional) Harden the audit log
Currently any authenticated user can insert arbitrary `audit_log` rows (`WITH CHECK (true)`), so entries can be forged. Optional: `WITH CHECK (employee_id = public.current_employee_id())`. Low priority since writes go through the server helper.

---
**After applying:** run the migration, `npx tsc --noEmit`, `next build`, and re-test login + employee management. Update `02_CONVENTIONS.md` with the `security_invoker = true` view rule and the `employee_secrets` pattern.

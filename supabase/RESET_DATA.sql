-- ============================================================================
-- MegaMaf — RESET DATA (rows only, schema intact)
-- ============================================================================
-- Truncates every application table in a single operation
-- so foreign-key constraints are satisfied and deadlocks are avoided.
--
-- ✅ KEEPS  : tables, views, functions, enums, indexes, triggers
-- ✅ KEEPS  : auth.users  →  all Supabase login accounts remain
-- ✅ KEEPS  : public.employees  →  all employee records remain
-- ✅ KEEPS  : public.employee_page_access  →  page permissions remain
-- ✅ KEEPS  : public.employee_project_access  →  cleared below & main re-granted
-- ✅ KEEPS  : public.employee_secrets  →  PIN hashes / secrets remain
-- ✅ KEEPS  : public.user_credentials  →  WebAuthn passkeys remain
-- ✅ KEEPS  : public.user_sessions  →  active sessions remain
-- ✅ KEEPS  : projects WHERE is_main = true  →  MAF Main Company remains
-- ❌ DELETES: all business / transaction data (claims, invoices, deposits …)
-- ❌ DELETES: all sub-projects, branches, phases
-- ❌ DELETES: all vendors, project owners, warehouses, inventory
--
-- ⚠️  THIS PERMANENTLY DELETES ALL BUSINESS DATA. There is no undo.
--
-- How to run:
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- ============================================================================

-- ── Step 1 : Truncate all transactional & business data ─────────────────────
-- Combining into a single TRUNCATE avoids lock-ordering deadlocks (40P01)
TRUNCATE
  public.claim_item_stock_bundles,
  public.claim_items,
  public.retention_releases,
  public.invoice_items,
  public.payment_allocations,
  public.owner_payment_schedule,
  public.owner_custody_disbursements,
  public.custody_settlements,
  public.deposit_payouts,
  public.stock_movements,
  public.opening_stock_entries,
  public.vendor_prior_claims,
  public.project_opening_balances,
  public.notifications,
  public.push_subscriptions,
  public.audit_log,
  public.attachments,
  public.claims,
  public.invoices,
  public.expenses,
  public.deposits,
  public.ledger_entries,
  public.bank_accounts,
  public.banks,
  public.expense_categories,
  public.warehouses,
  public.inventory_items
  CASCADE;

-- ── Step 2 : Remove employee project-access rows for non-main projects ───────
DELETE FROM public.employee_project_access
WHERE project_id != '00000000-0000-0000-0000-000000000001';

-- ── Step 3 : Delete non-main projects ───────────────────────────────────────
--   Must happen BEFORE we touch project_owners, because projects.owner_id
--   has a FK to project_owners. Deleting sub-projects first removes those FKs.
--   We also NULL-out the main company's owner_id so project_owners can be
--   cleared safely without cascading into the projects table.
UPDATE public.projects
SET owner_id = NULL
WHERE is_main = true;

DELETE FROM public.projects
WHERE is_main = false;

-- ── Step 4 : Delete vendors and related ─────────────────────────────────────
DELETE FROM public.vendor_project_access;
DELETE FROM public.vendors;

-- ── Step 5 : Delete project owners ──────────────────────────────────────────
--   Use DELETE (not TRUNCATE CASCADE) — TRUNCATE CASCADE on project_owners
--   would follow the FK projects.owner_id → project_owners.id and wipe
--   the entire projects table, including MAF Main Company.
DELETE FROM public.project_owners;

-- ── Step 6 : Reset app_settings to defaults ─────────────────────────────────
DELETE FROM public.app_settings;
INSERT INTO public.app_settings (key, value)
VALUES
  ('currencies',      '["EGP"]'::jsonb),
  ('lockout_policy',  '{"max_attempts": 5, "lockout_minutes": 15}'::jsonb);

-- ── Step 7 : Reset sequences (IDs restart from 1) ───────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
  ) LOOP
    EXECUTE 'ALTER SEQUENCE '
      || quote_ident(r.sequence_schema) || '.'
      || quote_ident(r.sequence_name)
      || ' RESTART WITH 1';
  END LOOP;
END $$;

-- ── Done ─────────────────────────────────────────────────────────────────────
-- All business / transaction data has been deleted.
-- Schema is untouched.
-- auth.users, employees, user_credentials, user_sessions,
-- employee_page_access, and employee_project_access (main company only)
-- are all preserved.
-- MAF Main Company (is_main = true) is preserved.

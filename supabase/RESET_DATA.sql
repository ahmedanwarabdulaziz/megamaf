-- ============================================================================
-- MegaMaf — RESET DATA (rows only, schema intact)
-- ============================================================================
-- Truncates every application table in the correct order (children first)
-- so foreign-key constraints are satisfied.
--
-- ✅ KEEPS  : tables, views, functions, enums, indexes, triggers
-- ✅ KEEPS  : auth.users  →  all login accounts remain
-- ✅ KEEPS  : storage objects (if any)
-- ❌ DELETES: every row in every application table listed below
--
-- ⚠️  THIS PERMANENTLY DELETES ALL DATA. There is no undo.
--
-- How to run:
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- ============================================================================

TRUNCATE
  -- ── Leaf / detail tables first ──────────────────────────────────────────
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
  public.user_sessions,

  -- ── Mid-level tables ─────────────────────────────────────────────────────
  public.claims,
  public.invoices,
  public.expenses,
  public.deposits,
  public.ledger_entries,
  public.bank_accounts,
  public.banks,
  public.expense_categories,
  public.employee_project_access,
  public.employee_page_access,
  public.employee_secrets,
  public.vendor_project_access,

  -- ── Root / lookup tables last ─────────────────────────────────────────────
  public.vendors,
  public.employees,
  public.project_owners,
  public.warehouses,
  public.inventory_items,
  public.app_settings,
  public.user_credentials,
  public.projects

  -- CASCADE handles any remaining FK references automatically
  CASCADE;

-- Reset all sequences so IDs restart from 1
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
  ) LOOP
    EXECUTE 'ALTER SEQUENCE ' || quote_ident(r.sequence_schema) || '.' || quote_ident(r.sequence_name) || ' RESTART WITH 1';
  END LOOP;
END $$;

-- ── Re-seed mandatory system rows ───────────────────────────────────────────
-- MAF Main Company is created by migration 0001 but wiped by the TRUNCATE
-- above. Re-insert it so the application works immediately after a reset.
INSERT INTO public.projects (id, name, code, node_type, is_main, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'MAF Main Company', 'MAIN', 'main_company', true, 'open')
ON CONFLICT (id) DO NOTHING;

-- Done. All rows deleted, schema untouched, users preserved.
-- MAF Main Company has been restored automatically.

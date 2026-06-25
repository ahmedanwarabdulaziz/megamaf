-- ============================================================
-- Migration 0031: Performance indexes + v_latest_owner_claims
-- ============================================================

-- ── 1. payment_allocations: CRITICAL — joined in 4+ financial views with no index ──
CREATE INDEX IF NOT EXISTS idx_payment_alloc_target
  ON public.payment_allocations(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_payment_alloc_ledger
  ON public.payment_allocations(ledger_entry_id);

-- ── 2. claims: status + claim_type — filtered on every single claims query ──
CREATE INDEX IF NOT EXISTS idx_claims_status
  ON public.claims(status);

CREATE INDEX IF NOT EXISTS idx_claims_claim_type
  ON public.claims(claim_type);

-- Composite: covers the v_claim_totals LATERAL subquery pattern
-- WHERE project_id = X AND party_id = Y AND claim_type = Z AND status = 'approved' AND claim_number < N
CREATE INDEX IF NOT EXISTS idx_claims_composite
  ON public.claims(project_id, party_id, claim_type, status, claim_number);

-- ── 3. ledger_entries: category + direction — unindexed despite heavy filtering ──
CREATE INDEX IF NOT EXISTS idx_ledger_category
  ON public.ledger_entries(category);

CREATE INDEX IF NOT EXISTS idx_ledger_direction
  ON public.ledger_entries(direction);

-- Composite: most treasury queries filter on category + direction together + date sort
CREATE INDEX IF NOT EXISTS idx_ledger_category_direction_date
  ON public.ledger_entries(category, direction, entry_date DESC);

-- ── 4. invoices: status ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON public.invoices(status);

-- ── 5. expenses: project_id (used in v_project_financial_position) ───────────
CREATE INDEX IF NOT EXISTS idx_expenses_project_id
  ON public.expenses(project_id);

-- owner_id already created in migration 0020 — skip duplicate

-- ── 6. owner_payment_schedule: project_id + status ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_owner_schedule_project
  ON public.owner_payment_schedule(project_id);

CREATE INDEX IF NOT EXISTS idx_owner_schedule_status
  ON public.owner_payment_schedule(status);

-- ── 7. deposit_payouts: is_collected + due_date (home dashboard filter) ──────
CREATE INDEX IF NOT EXISTS idx_deposit_payouts_collected_date
  ON public.deposit_payouts(is_collected, due_date);

-- ── 8. v_latest_owner_claims: pre-compute latest approved claim per (owner, project) ──
-- Replaces the unbounded SELECT + JS DISTINCT ON in treasury/page.tsx
CREATE OR REPLACE VIEW public.v_latest_owner_claims AS
SELECT DISTINCT ON (party_id, project_id)
  id          AS claim_id,
  party_id,
  project_id,
  claim_number
FROM public.claims
WHERE claim_type = 'owner'
  AND status    = 'approved'
ORDER BY party_id, project_id, claim_number DESC;

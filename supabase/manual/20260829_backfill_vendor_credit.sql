-- ONE-TIME MANUAL SCRIPT — not part of the migration history, run by hand
-- when ready (e.g. via the Supabase SQL editor, or:
--   supabase db query --file supabase/manual/20260829_backfill_vendor_credit.sql --db-url "<connection string>"
-- ).
--
-- Sweeps EXISTING unallocated vendor payment credit against EXISTING open
-- claim balances, using the same rule the approve_claim() auto-settlement
-- (20260829120000_auto_assign_vendor_credit_on_claim_approval.sql) now
-- applies going forward on every new claim approval:
--   - only credit already tagged to a project (untagged/general credit is
--     left alone — same ambiguity concern as the live trigger, but simpler
--     to just skip it here since this only runs once)
--   - within a project, the NEWEST approved claim gets first claim on the
--     credit (claims are cumulative, so that's the one actually tracked),
--     falling back to older claims only if it can't absorb all of it
--   - each claim is capped by its own remaining bucket
--     (total_due_this_claim - v_claim_paid), the same figure
--     record_vendor_payment/assign_vendor_payment validate against
--   - oldest credit entry consumed first (FIFO on the advance side)
--
-- Every allocation is real: a payment_allocations row plus an audit_log
-- entry (action 'update', entity_type 'claim_auto_settlement') so it's
-- traceable exactly like the live trigger's entries. Safe to re-run: once
-- credit is consumed it no longer appears as unallocated, so a second run
-- finds nothing left to do.

DO $$
DECLARE
  v_vendor_project RECORD;
  v_claim          RECORD;
  v_credit         RECORD;
  v_claim_room     numeric;
  v_take           numeric;
BEGIN
  -- Every distinct (vendor, project) pair that currently has unallocated,
  -- project-tagged credit.
  FOR v_vendor_project IN
    SELECT DISTINCT le.counterparty_id AS vendor_id, le.project_id
    FROM public.ledger_entries le
    LEFT JOIN public.payment_allocations pa ON pa.ledger_entry_id = le.id
    WHERE le.counterparty_type = 'vendor'
      AND le.direction = 'out'
      AND le.project_id IS NOT NULL
    GROUP BY le.counterparty_id, le.project_id, le.id, le.amount
    HAVING (le.amount - COALESCE((
      SELECT SUM(allocated_amount) FROM public.payment_allocations
      WHERE ledger_entry_id = le.id
    ), 0)) > 0.01
  LOOP
    -- Newest-approved-claim-first for this vendor/project, oldest last
    -- (claim #0's legacy opening balance is claim_number 0, so it's
    -- naturally last unless every later claim is already fully settled).
    FOR v_claim IN
      SELECT c.id
      FROM public.claims c
      WHERE c.party_id = v_vendor_project.vendor_id
        AND c.project_id = v_vendor_project.project_id
        AND c.claim_type = 'vendor'
        AND c.status = 'approved'
      ORDER BY c.claim_number DESC
    LOOP
      SELECT COALESCE((SELECT total_due_this_claim FROM public.v_claim_totals WHERE claim_id = v_claim.id), 0)
           - COALESCE((SELECT paid_amount FROM public.v_claim_paid WHERE claim_id = v_claim.id), 0)
      INTO v_claim_room;

      CONTINUE WHEN v_claim_room <= 0;

      FOR v_credit IN
        SELECT le.id AS ledger_entry_id,
               le.amount - COALESCE(SUM(pa.allocated_amount), 0) AS remaining_credit
        FROM public.ledger_entries le
        LEFT JOIN public.payment_allocations pa ON pa.ledger_entry_id = le.id
        WHERE le.counterparty_type = 'vendor'
          AND le.counterparty_id = v_vendor_project.vendor_id
          AND le.project_id = v_vendor_project.project_id
          AND le.direction = 'out'
        GROUP BY le.id, le.amount, le.entry_date
        HAVING (le.amount - COALESCE(SUM(pa.allocated_amount), 0)) > 0.01
        ORDER BY le.entry_date ASC
      LOOP
        EXIT WHEN v_claim_room <= 0;

        v_take := LEAST(v_credit.remaining_credit, v_claim_room);
        IF v_take > 0 THEN
          INSERT INTO public.payment_allocations (ledger_entry_id, target_type, target_id, allocated_amount)
          VALUES (v_credit.ledger_entry_id, 'claim', v_claim.id, v_take);

          v_claim_room := v_claim_room - v_take;

          INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
          VALUES (NULL, 'update', 'claim_auto_settlement', v_claim.id,
                  jsonb_build_object('ledger_entry_id', v_credit.ledger_entry_id, 'amount', v_take, 'source', 'backfill_20260829'));
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

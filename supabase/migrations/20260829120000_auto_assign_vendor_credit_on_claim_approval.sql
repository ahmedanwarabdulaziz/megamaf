-- 20260829120000_auto_assign_vendor_credit_on_claim_approval.sql
--
-- Advance payments to a vendor (paid before any claim exists to attach them
-- to) sit as unallocated credit in ledger_entries until an admin manually
-- runs the "settle from credit" flow. The business requirement: an advance
-- payment IS the future certified work — the moment a claim for that vendor
-- gets approved, whatever unallocated credit it has should automatically be
-- applied to that claim's own remaining balance, up to what the claim can
-- absorb. Example: vendor paid a 100 advance, then a claim for 30 gets
-- approved — 30 of the advance is auto-assigned to the claim, leaving 70
-- still available as credit for the next one.
--
-- This extends approve_claim() (latest definition: 0052_claim_zero.sql) with
-- that step, right after the claim is marked approved and before the
-- claim#0 early-return (so it applies uniformly to claim#0 and numbered
-- claims alike). Only vendor claims are eligible — owner claims have no
-- equivalent "credit" concept.
--
-- Scope of eligible credit, mirroring the existing manual settlement rules
-- (assign_vendor_payment / v_vendor_unallocated_credit): only ledger entries
-- already tied to THIS claim's project, or not yet tied to any project at
-- all (tagged to this project the first time they're used here) — credit
-- already tied to a DIFFERENT project is left untouched, so money earmarked
-- for one project is never silently pulled into another vendor claim.
-- Oldest advance first (FIFO) — there is no "cumulative claim" argument on
-- the credit side the way there is for which claim receives money.

CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status      text;
  v_emp_id      uuid;
  v_project_id  uuid;
  v_party_id    uuid;
  v_claim_type  text;
  v_item        record;
  v_bundle      record;
  v_on_hand     numeric;
  v_deduct_qty  numeric;
  v_claim_due   numeric;
  v_claim_paid  numeric;
  v_claim_room  numeric;
  v_credit      record;
  v_take        numeric;
BEGIN
  v_emp_id := public.current_employee_id();

  SELECT status, project_id, party_id, claim_type
  INTO   v_status, v_project_id, v_party_id, v_claim_type
  FROM   public.claims
  WHERE  id = p_claim_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  IF NOT public.has_project_access(v_project_id)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET    status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE  id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (v_emp_id, 'approve', 'claim', p_claim_id,
          jsonb_build_object('status', 'approved'));

  -- ── Auto-assign existing unallocated vendor credit to this claim ──────
  IF v_claim_type = 'vendor' THEN
    SELECT total_due_this_claim INTO v_claim_due
    FROM public.v_claim_totals WHERE claim_id = p_claim_id;

    SELECT paid_amount INTO v_claim_paid
    FROM public.v_claim_paid WHERE claim_id = p_claim_id;

    v_claim_room := COALESCE(v_claim_due, 0) - COALESCE(v_claim_paid, 0);

    IF v_claim_room > 0 THEN
      FOR v_credit IN
        SELECT le.id AS ledger_entry_id,
               le.amount - COALESCE(SUM(pa.allocated_amount), 0) AS remaining_credit
        FROM   public.ledger_entries le
        LEFT JOIN public.payment_allocations pa ON pa.ledger_entry_id = le.id
        WHERE  le.counterparty_type = 'vendor'
          AND  le.counterparty_id   = v_party_id
          AND  le.direction         = 'out'
          AND  (le.project_id = v_project_id OR le.project_id IS NULL)
        GROUP BY le.id, le.amount, le.entry_date
        HAVING (le.amount - COALESCE(SUM(pa.allocated_amount), 0)) > 0.01
        ORDER BY le.entry_date ASC
      LOOP
        EXIT WHEN v_claim_room <= 0;

        v_take := LEAST(v_credit.remaining_credit, v_claim_room);
        IF v_take > 0 THEN
          -- Tag the ledger entry with this project only the first time it's
          -- used — mirrors assign_vendor_payment's own rule, so a later
          -- incremental draw against a different project never retags it.
          UPDATE public.ledger_entries
          SET    project_id = v_project_id
          WHERE  id = v_credit.ledger_entry_id AND project_id IS NULL;

          INSERT INTO public.payment_allocations (ledger_entry_id, target_type, target_id, allocated_amount)
          VALUES (v_credit.ledger_entry_id, 'claim', p_claim_id, v_take);

          v_claim_room := v_claim_room - v_take;

          INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
          VALUES (v_emp_id, 'update', 'claim_auto_settlement', p_claim_id,
                  jsonb_build_object('ledger_entry_id', v_credit.ledger_entry_id, 'amount', v_take));
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- ── Skip ALL warehouse deductions for Claim #0 (opening balance — historical) ──
  IF (SELECT claim_number FROM public.claims WHERE id = p_claim_id) = 0 THEN
    RETURN;
  END IF;

  -- ── New bundle-based deductions ──────────────────────────────────────
  FOR v_item IN
    SELECT ci.id AS claim_item_id, ci.current_qty
    FROM   public.claim_items ci
    WHERE  ci.claim_id = p_claim_id
      AND  ci.is_stock_issue = true
  LOOP
    FOR v_bundle IN
      SELECT b.warehouse_id, b.item_id, b.qty_per_unit
      FROM   public.claim_item_stock_bundles b
      WHERE  b.claim_item_id = v_item.claim_item_id
    LOOP
      v_deduct_qty := v_bundle.qty_per_unit * v_item.current_qty;

      SELECT COALESCE(
        (SELECT qty_on_hand
         FROM   public.v_stock_on_hand
         WHERE  warehouse_id = v_bundle.warehouse_id
           AND  item_id      = v_bundle.item_id),
        0
      ) INTO v_on_hand;

      IF v_on_hand < v_deduct_qty THEN
        RAISE EXCEPTION
          'Insufficient stock for item % in warehouse %. Have %, need %',
          v_bundle.item_id, v_bundle.warehouse_id, v_on_hand, v_deduct_qty;
      END IF;

      INSERT INTO public.stock_movements (
        warehouse_id, item_id, movement_type, qty,
        reference_id, notes, created_by
      ) VALUES (
        v_bundle.warehouse_id, v_bundle.item_id,
        'issue', -v_deduct_qty,
        p_claim_id, 'Claim bundle issue', v_emp_id
      );
    END LOOP;

    -- ── Legacy fallback: single item_id on claim_items (no bundle rows) ──
    IF NOT EXISTS (
      SELECT 1 FROM public.claim_item_stock_bundles
      WHERE claim_item_id = v_item.claim_item_id
    ) THEN
      FOR v_bundle IN
        SELECT warehouse_id, item_id, current_qty AS qty_per_unit
        FROM   public.claim_items
        WHERE  id             = v_item.claim_item_id
          AND  warehouse_id   IS NOT NULL
          AND  item_id        IS NOT NULL
      LOOP
        SELECT COALESCE(
          (SELECT qty_on_hand
           FROM   public.v_stock_on_hand
           WHERE  warehouse_id = v_bundle.warehouse_id
             AND  item_id      = v_bundle.item_id),
          0
        ) INTO v_on_hand;

        IF v_on_hand < v_bundle.qty_per_unit THEN
          RAISE EXCEPTION
            'Insufficient stock for item % in warehouse % (legacy). Have %, need %',
            v_bundle.item_id, v_bundle.warehouse_id,
            v_on_hand, v_bundle.qty_per_unit;
        END IF;

        INSERT INTO public.stock_movements (
          warehouse_id, item_id, movement_type, qty,
          reference_id, notes, created_by
        ) VALUES (
          v_bundle.warehouse_id, v_bundle.item_id,
          'issue', -v_bundle.qty_per_unit,
          p_claim_id, 'Owner claim issue (legacy)', v_emp_id
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

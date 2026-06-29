-- 0035_claim_item_stock_bundles.sql
-- Replaces the single warehouse_id / item_id on claim_items with a
-- bundle table: many warehouse-items per claim item, each with a
-- qty_per_unit factor.  On approval, qty_per_unit × current_qty is
-- deducted from stock for every row in the bundle.

-- 1. New bundle table
CREATE TABLE public.claim_item_stock_bundles (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_item_id uuid          NOT NULL REFERENCES public.claim_items(id) ON DELETE CASCADE,
  warehouse_id  uuid          NOT NULL REFERENCES public.warehouses(id),
  item_id       uuid          NOT NULL REFERENCES public.inventory_items(id),
  qty_per_unit  numeric(18,4) NOT NULL CHECK (qty_per_unit > 0),
  created_at    timestamptz   DEFAULT now()
);

CREATE INDEX idx_claim_item_bundles_item ON public.claim_item_stock_bundles(claim_item_id);

-- 2. RLS – same scope as claim_items
ALTER TABLE public.claim_item_stock_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bundle rows selectable scoped"
  ON public.claim_item_stock_bundles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.claim_items ci
      JOIN public.claims c ON c.id = ci.claim_id
      WHERE ci.id = claim_item_id
        AND (public.is_super_admin() OR public.has_project_access(c.project_id))
    )
  );

CREATE POLICY "Bundle rows insertable scoped"
  ON public.claim_item_stock_bundles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.claim_items ci
      JOIN public.claims c ON c.id = ci.claim_id
      WHERE ci.id = claim_item_id
        AND (public.is_super_admin() OR public.has_project_access(c.project_id))
    )
  );

CREATE POLICY "Bundle rows deletable scoped"
  ON public.claim_item_stock_bundles
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.claim_items ci
      JOIN public.claims c ON c.id = ci.claim_id
      WHERE ci.id = claim_item_id
        AND (public.is_super_admin() OR public.has_project_access(c.project_id))
    )
  );

-- 3. Update approve_claim to handle both legacy (single item_id) and
--    new bundle rows.
CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status     text;
  v_emp_id     uuid;
  v_project_id uuid;
  v_item       record;
  v_bundle     record;
  v_on_hand    numeric;
  v_deduct_qty numeric;
BEGIN
  v_emp_id := public.current_employee_id();

  SELECT status, project_id
  INTO   v_status, v_project_id
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
      -- Use old-style warehouse_id / item_id columns
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

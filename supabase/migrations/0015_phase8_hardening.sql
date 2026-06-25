-- 0015_phase8_hardening.sql

-- 1. Restore has_project_access and audit_log to approve_invoice
CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_emp_id uuid;
  v_item record;
  v_project_id uuid;
BEGIN
  v_emp_id := public.current_employee_id();

  SELECT status, project_id INTO v_status, v_project_id FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve invoices';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (v_emp_id, 'approve', 'invoice', p_invoice_id, jsonb_build_object('status', 'approved'));

  -- Phase 8: Generate stock movements for warehouse items
  FOR v_item IN 
    SELECT warehouse_id, item_id, qty, unit_price 
    FROM public.invoice_items 
    WHERE invoice_id = p_invoice_id AND warehouse_id IS NOT NULL AND item_id IS NOT NULL
  LOOP
    INSERT INTO public.stock_movements (
      warehouse_id, item_id, movement_type, qty, unit_price, reference_id, notes, created_by
    ) VALUES (
      v_item.warehouse_id, v_item.item_id, 'in_invoice', v_item.qty, v_item.unit_price, p_invoice_id, 'Invoice receipt', v_emp_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Restore has_project_access and audit_log to approve_claim
CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_emp_id uuid;
  v_item record;
  v_on_hand numeric;
  v_project_id uuid;
BEGIN
  v_emp_id := public.current_employee_id();

  SELECT status, project_id INTO v_status, v_project_id FROM public.claims WHERE id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (v_emp_id, 'approve', 'claim', p_claim_id, jsonb_build_object('status', 'approved'));

  -- Phase 8: Generate stock issue movements
  FOR v_item IN 
    SELECT warehouse_id, item_id, current_qty 
    FROM public.claim_items 
    WHERE claim_id = p_claim_id AND is_stock_issue = true AND warehouse_id IS NOT NULL AND item_id IS NOT NULL
  LOOP
    -- Verify we have enough stock, don't allow silent negative stock
    SELECT COALESCE((SELECT qty_on_hand FROM public.v_stock_on_hand WHERE warehouse_id = v_item.warehouse_id AND item_id = v_item.item_id), 0)
    INTO v_on_hand;

    IF v_on_hand < v_item.current_qty THEN
        RAISE EXCEPTION 'Insufficient stock for item % in warehouse % to issue claim. Have %, need %', v_item.item_id, v_item.warehouse_id, v_on_hand, v_item.current_qty;
    END IF;

    -- Note: issue is negative qty
    INSERT INTO public.stock_movements (
      warehouse_id, item_id, movement_type, qty, reference_id, notes, created_by
    ) VALUES (
      v_item.warehouse_id, v_item.item_id, 'issue', -v_item.current_qty, p_claim_id, 'Owner claim issue', v_emp_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Add authorization checks to record_stock_transfer
CREATE OR REPLACE FUNCTION public.record_stock_transfer(
    p_from_warehouse_id uuid,
    p_to_warehouse_id uuid,
    p_item_id uuid,
    p_qty numeric,
    p_notes text
) RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_on_hand numeric;
    v_from_proj uuid;
    v_to_proj uuid;
BEGIN
    v_emp_id := public.current_employee_id();

    IF p_from_warehouse_id = p_to_warehouse_id THEN
        RAISE EXCEPTION 'Cannot transfer to the same warehouse';
    END IF;

    -- Check project scoping
    SELECT project_id INTO v_from_proj FROM public.warehouses WHERE id = p_from_warehouse_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source warehouse not found'; END IF;
    
    SELECT project_id INTO v_to_proj FROM public.warehouses WHERE id = p_to_warehouse_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Destination warehouse not found'; END IF;

    IF NOT public.is_super_admin() THEN
        IF NOT public.has_page_access('inventory') THEN
            RAISE EXCEPTION 'Not authorized to manage inventory';
        END IF;
        
        IF v_from_proj IS NOT NULL AND NOT public.has_project_access(v_from_proj) THEN
            RAISE EXCEPTION 'Not authorized on source project';
        END IF;
        
        IF v_to_proj IS NOT NULL AND NOT public.has_project_access(v_to_proj) THEN
            RAISE EXCEPTION 'Not authorized on destination project';
        END IF;
    END IF;

    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'Transfer quantity must be > 0';
    END IF;

    -- Check stock
    SELECT COALESCE((SELECT qty_on_hand FROM public.v_stock_on_hand WHERE warehouse_id = p_from_warehouse_id AND item_id = p_item_id), 0)
    INTO v_on_hand;

    IF v_on_hand < p_qty THEN
        RAISE EXCEPTION 'Insufficient stock in source warehouse';
    END IF;

    -- Transfer out
    INSERT INTO public.stock_movements (
        warehouse_id, item_id, movement_type, qty, notes, created_by
    ) VALUES (
        p_from_warehouse_id, p_item_id, 'transfer_out', -p_qty, p_notes, v_emp_id
    );

    -- Transfer in
    INSERT INTO public.stock_movements (
        warehouse_id, item_id, movement_type, qty, notes, created_by
    ) VALUES (
        p_to_warehouse_id, p_item_id, 'transfer_in', p_qty, p_notes, v_emp_id
    );

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'stock_transfer', p_from_warehouse_id, jsonb_build_object('item_id', p_item_id, 'qty', p_qty, 'to_warehouse', p_to_warehouse_id));

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Add updated_at triggers
DROP TRIGGER IF EXISTS set_updated_at_warehouses ON public.warehouses;
CREATE TRIGGER set_updated_at_warehouses
BEFORE UPDATE ON public.warehouses
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_inventory_items ON public.inventory_items;
CREATE TRIGGER set_updated_at_inventory_items
BEFORE UPDATE ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

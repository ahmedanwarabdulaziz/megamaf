-- 20260727130100_inventory_edit_access.sql
--
-- This is the fix for the reported bug: inventory_items/warehouses/
-- stock_movements/item_categories write policies checked is_super_admin()
-- only, never has_page_access('inventory') — so granting the "المخازن" page
-- permission alone never let an employee write inventory data. Also brings
-- opening_stock_entries (same super-admin-only pattern) and the
-- record_stock_transfer() RPC (already checked has_page_access('inventory')
-- with no level) in line with the new 'edit' level.

-- Using DROP + CREATE instead of ALTER POLICY: this repo's migrations/
-- folder does not necessarily match what has actually been applied to the
-- live database (e.g. 0061_fix_claims_rls_update.sql turned out to never
-- have been run there), so ALTER POLICY's "policy must already exist"
-- requirement is unsafe to rely on. DROP POLICY IF EXISTS + CREATE POLICY
-- works whether or not the policy currently exists.

DROP POLICY IF EXISTS "Items modifiable by admins" ON public.inventory_items;
CREATE POLICY "Items modifiable by admins" ON public.inventory_items
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('inventory', 'edit'))
  WITH CHECK (public.is_super_admin() OR public.has_page_access('inventory', 'edit'));

DROP POLICY IF EXISTS "Warehouses modifiable by admins" ON public.warehouses;
CREATE POLICY "Warehouses modifiable by admins" ON public.warehouses
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('inventory', 'edit'))
  WITH CHECK (public.is_super_admin() OR public.has_page_access('inventory', 'edit'));

DROP POLICY IF EXISTS "Movements insertable by admins" ON public.stock_movements;
CREATE POLICY "Movements insertable by admins" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.has_page_access('inventory', 'edit'));

DROP POLICY IF EXISTS "Categories modifiable by admins" ON public.item_categories;
CREATE POLICY "Categories modifiable by admins" ON public.item_categories
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('inventory', 'edit'))
  WITH CHECK (public.is_super_admin() OR public.has_page_access('inventory', 'edit'));

DROP POLICY IF EXISTS "Opening stock write super admin only" ON public.opening_stock_entries;
CREATE POLICY "Opening stock write super admin only" ON public.opening_stock_entries
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_page_access('inventory', 'edit'))
  WITH CHECK (public.is_super_admin() OR public.has_page_access('inventory', 'edit'));

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
        IF NOT public.has_page_access('inventory', 'edit') THEN
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

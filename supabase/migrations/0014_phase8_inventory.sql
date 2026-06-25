-- 0014_phase8_inventory.sql

-- 1. Tables
CREATE TABLE public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  project_id uuid references public.projects(id), -- null means main company warehouse
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  unit text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type text not null check (movement_type in ('in_invoice', 'transfer_out', 'transfer_in', 'issue', 'adjust')),
  qty numeric(18,4) not null, 
  unit_price numeric(18,2),
  reference_id uuid,
  notes text,
  created_by uuid references public.employees(id),
  created_at timestamptz default now()
);

CREATE INDEX idx_stock_movements_wh_item ON public.stock_movements(warehouse_id, item_id);

-- 2. Alter existing tables
ALTER TABLE public.invoice_items ADD COLUMN item_id uuid REFERENCES public.inventory_items(id);
ALTER TABLE public.claim_items ADD COLUMN item_id uuid REFERENCES public.inventory_items(id);

ALTER TABLE public.invoice_items ADD CONSTRAINT chk_invoice_item_warehouse CHECK (
    (warehouse_id IS NULL AND item_id IS NULL) OR 
    (warehouse_id IS NOT NULL AND item_id IS NOT NULL) OR
    (warehouse_id IS NULL AND item_id IS NOT NULL)
);

ALTER TABLE public.claim_items ADD CONSTRAINT chk_claim_item_stock_issue CHECK (
    (is_stock_issue = false) OR 
    (is_stock_issue = true AND warehouse_id IS NOT NULL AND item_id IS NOT NULL)
);

-- 3. View
CREATE OR REPLACE VIEW public.v_stock_on_hand WITH (security_invoker = true) AS
SELECT 
  m.warehouse_id,
  m.item_id,
  w.name as warehouse_name,
  w.project_id,
  i.name as item_name,
  i.code as item_code,
  i.unit as item_unit,
  SUM(m.qty) as qty_on_hand
FROM public.stock_movements m
JOIN public.warehouses w ON w.id = m.warehouse_id
JOIN public.inventory_items i ON i.id = m.item_id
GROUP BY m.warehouse_id, m.item_id, w.name, w.project_id, i.name, i.code, i.unit;

-- 4. Modifying approve RPCs to trigger movements
CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_emp_id uuid;
  v_item record;
BEGIN
  v_emp_id := public.current_employee_id();
  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve invoices';
  END IF;

  SELECT status INTO v_status FROM public.invoices WHERE id = p_invoice_id;
  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE id = p_invoice_id;

  -- Generate stock movements for warehouse items
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

CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_emp_id uuid;
  v_item record;
  v_on_hand numeric;
BEGIN
  v_emp_id := public.current_employee_id();
  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  SELECT status INTO v_status FROM public.claims WHERE id = p_claim_id;
  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE id = p_claim_id;

  -- Generate stock issue movements
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

-- 5. Movement RPCs
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
BEGIN
    v_emp_id := public.current_employee_id();

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

-- 6. RLS
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Items viewable by all authenticated" ON public.inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Items modifiable by admins" ON public.inventory_items FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Warehouses scoped to projects" ON public.warehouses
FOR SELECT TO authenticated USING (
    project_id IS NULL OR public.is_super_admin() OR public.has_project_access(project_id)
);
CREATE POLICY "Warehouses modifiable by admins" ON public.warehouses FOR ALL TO authenticated USING (public.is_super_admin());

CREATE POLICY "Movements scoped to warehouse project" ON public.stock_movements
FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = warehouse_id AND (w.project_id IS NULL OR public.is_super_admin() OR public.has_project_access(w.project_id)))
);

CREATE POLICY "Movements insertable by admins" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

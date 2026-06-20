-- ============================================================
-- 11. SUPPLIES & ITEM CATALOG
-- ============================================================

-- ============================================================
-- 11.1 ITEM CATALOG (دليل الأصناف)
-- ============================================================
CREATE TABLE public.item_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  unit_of_measure text NOT NULL, -- e.g. طن، كجم، متر، حبة
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TRIGGER set_item_catalog_updated_at
BEFORE UPDATE ON public.item_catalog
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.item_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read item_catalog in their company" ON public.item_catalog FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "Users can insert item_catalog in their company" ON public.item_catalog FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "Users can update item_catalog in their company" ON public.item_catalog FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY "Admins can delete item_catalog in their company" ON public.item_catalog FOR DELETE USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

-- ============================================================
-- 11.2 PURCHASE ORDERS (أوامر الشراء)
-- ============================================================
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  po_number text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft', -- 'draft', 'approved', 'received', 'paid'
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at timestamptz,
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at timestamptz,
  paid_from_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER set_purchase_orders_updated_at
BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read purchase_orders in their company" ON public.purchase_orders FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "Users can insert purchase_orders in their company" ON public.purchase_orders FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "Users can update purchase_orders in their company" ON public.purchase_orders FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY "Admins can delete purchase_orders in their company" ON public.purchase_orders FOR DELETE USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

-- ============================================================
-- 11.3 PURCHASE ORDER ITEMS (بنود أمر الشراء)
-- ============================================================
CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES public.item_catalog(id) ON DELETE RESTRICT,
  quantity numeric(14,2) NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  total_price numeric(14,2) NOT NULL,
  item_type text NOT NULL DEFAULT 'stored', -- 'stored' (مخزني) | 'consumable' (مستهلك)
  target_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read purchase_order_items in their company" ON public.purchase_order_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = po_id AND po.company_id = get_my_company_id())
);
CREATE POLICY "Users can insert purchase_order_items in their company" ON public.purchase_order_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = po_id AND po.company_id = get_my_company_id())
);
CREATE POLICY "Users can update purchase_order_items in their company" ON public.purchase_order_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = po_id AND po.company_id = get_my_company_id())
);
CREATE POLICY "Users can delete purchase_order_items in their company" ON public.purchase_order_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = po_id AND po.company_id = get_my_company_id())
);

-- ============================================================
-- 11.4 WAREHOUSE INVENTORY (رصيد المخازن)
-- ============================================================
CREATE TABLE public.warehouse_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES public.item_catalog(id) ON DELETE CASCADE,
  current_quantity numeric(14,2) NOT NULL DEFAULT 0,
  average_unit_price numeric(14,2) NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (warehouse_id, catalog_item_id)
);

CREATE TRIGGER set_warehouse_inventory_updated_at
BEFORE UPDATE ON public.warehouse_inventory
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.warehouse_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read warehouse_inventory in their company" ON public.warehouse_inventory FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = warehouse_id AND w.company_id = get_my_company_id())
);
-- Insert/Update handled by database functions usually, but we can allow users.
CREATE POLICY "Users can insert warehouse_inventory in their company" ON public.warehouse_inventory FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = warehouse_id AND w.company_id = get_my_company_id())
);
CREATE POLICY "Users can update warehouse_inventory in their company" ON public.warehouse_inventory FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = warehouse_id AND w.company_id = get_my_company_id())
);

-- ============================================================
-- 11.5 INVENTORY TRANSACTIONS (حركات المخازن)
-- ============================================================
CREATE TABLE public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES public.item_catalog(id) ON DELETE CASCADE,
  transaction_type text NOT NULL, -- 'in', 'out'
  quantity numeric(14,2) NOT NULL,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  reference_po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read inventory_transactions in their company" ON public.inventory_transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = warehouse_id AND w.company_id = get_my_company_id())
);
CREATE POLICY "Users can insert inventory_transactions in their company" ON public.inventory_transactions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = warehouse_id AND w.company_id = get_my_company_id())
);

-- ============================================================
-- Simplify Schema: Drop unused modules (Projects, Vendors, Supplies, Warehouses)
-- ============================================================

-- 1. Drop constraints from expenses / custodies
ALTER TABLE public.employee_custodies DROP COLUMN IF EXISTS project_id;

ALTER TABLE public.project_expenses DROP COLUMN IF EXISTS project_id;
ALTER TABLE public.project_expenses DROP COLUMN IF EXISTS vendor_id;

-- 2. Rename project_expenses to expenses
ALTER TABLE public.project_expenses RENAME TO expenses;

-- 3. Drop tables in order of dependencies
DROP TABLE IF EXISTS public.inventory_transactions CASCADE;
DROP TABLE IF EXISTS public.warehouse_inventory CASCADE;
DROP TABLE IF EXISTS public.warehouses CASCADE;

DROP TABLE IF EXISTS public.purchase_order_items CASCADE;
DROP TABLE IF EXISTS public.purchase_orders CASCADE;
DROP TABLE IF EXISTS public.item_catalog CASCADE;

DROP TABLE IF EXISTS public.employee_project_access CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP TABLE IF EXISTS public.vendors CASCADE;

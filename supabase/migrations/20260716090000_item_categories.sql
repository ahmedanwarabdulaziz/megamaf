-- 20260716090000_item_categories.sql
-- Two-level item categories (main -> sub) for inventory items.
--
-- NOTE: the app is live — concurrent requests reading inventory tables can
-- collide with the exclusive locks this migration needs (deadlock / timeout).
-- Every statement here is idempotent, so if it fails: just RUN IT AGAIN.
-- Retrying during a quiet moment (or right after a deploy) succeeds fastest.

-- Fail fast instead of queuing behind live traffic and deadlocking
SET lock_timeout = '10s';

-- 1. Categories table
CREATE TABLE IF NOT EXISTS public.item_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.item_categories(id) on delete restrict, -- null = main category
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Unique names per level (partial indexes because NULLs never collide in a plain unique constraint)
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_categories_root_name ON public.item_categories (name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_categories_sub_name ON public.item_categories (parent_id, name) WHERE parent_id IS NOT NULL;

-- Enforce a maximum of two levels
CREATE OR REPLACE FUNCTION public.check_item_category_depth()
RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'Category cannot be its own parent';
    END IF;
    IF EXISTS (SELECT 1 FROM public.item_categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Sub-categories cannot have children (max two levels)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.item_categories WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'A category that has sub-categories cannot become a sub-category';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_item_category_depth ON public.item_categories;
CREATE TRIGGER trg_item_category_depth
BEFORE INSERT OR UPDATE ON public.item_categories
FOR EACH ROW EXECUTE FUNCTION public.check_item_category_depth();

-- 2. Link items to categories
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.item_categories(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON public.inventory_items(category_id);

-- Category is required. NOT NULL can only apply while every row is categorized;
-- production has no items yet so this applies cleanly. If rows exist, the column
-- stays nullable and a NOTICE is raised — categorize them, then run:
--   ALTER TABLE public.inventory_items ALTER COLUMN category_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE category_id IS NULL) THEN
    ALTER TABLE public.inventory_items ALTER COLUMN category_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'inventory_items has uncategorized rows — category_id left nullable for now.';
  END IF;
END $$;

-- 3. RLS (mirrors inventory_items: readable by all authenticated, writable by admins)
ALTER TABLE public.item_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Categories viewable by all authenticated" ON public.item_categories;
CREATE POLICY "Categories viewable by all authenticated" ON public.item_categories
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Categories modifiable by admins" ON public.item_categories;
CREATE POLICY "Categories modifiable by admins" ON public.item_categories
FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- 4. Extend v_stock_on_hand with category info (new columns appended at the end,
--    which is the only shape CREATE OR REPLACE VIEW accepts)
CREATE OR REPLACE VIEW public.v_stock_on_hand WITH (security_invoker = true) AS
SELECT
  m.warehouse_id,
  m.item_id,
  w.name as warehouse_name,
  w.project_id,
  i.name as item_name,
  i.code as item_code,
  i.unit as item_unit,
  SUM(m.qty) as qty_on_hand,
  i.category_id,
  c.name as category_name,
  c.parent_id as parent_category_id,
  pc.name as parent_category_name
FROM public.stock_movements m
JOIN public.warehouses w ON w.id = m.warehouse_id
JOIN public.inventory_items i ON i.id = m.item_id
LEFT JOIN public.item_categories c ON c.id = i.category_id
LEFT JOIN public.item_categories pc ON pc.id = c.parent_id
GROUP BY m.warehouse_id, m.item_id, w.name, w.project_id, i.name, i.code, i.unit,
         i.category_id, c.name, c.parent_id, pc.name;

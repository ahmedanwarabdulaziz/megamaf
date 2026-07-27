-- 20260727100000_unique_inventory_item_name.sql
-- Prevent adding two inventory items with the same name (in addition to the existing unique code).

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_name ON public.inventory_items (name);

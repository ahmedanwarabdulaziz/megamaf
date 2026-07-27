-- 20260727130000_page_access_levels.sql
--
-- Bug reported: granting an employee a page permission (e.g. "المخازن" /
-- inventory) does not actually let them write data on that page — only
-- flipping them to full super-admin does. Root cause: several write-side RLS
-- policies (inventory_items, warehouses, stock_movements, item_categories,
-- and others across the app) check is_super_admin() only, never
-- has_page_access(slug) at all.
--
-- Fix, generalized app-wide: split page access into two levels, 'view' and
-- 'edit', instead of the current binary grant. A follow-up migration in this
-- same batch updates every affected write policy/RPC to require the 'edit'
-- level; this migration only adds the underlying column + function.
--
-- DEFAULT 'edit' matters: existing employee_page_access rows get backfilled
-- to 'edit' automatically, preserving today's actual behavior for every
-- module where a bare page-slug grant already implied full read/write
-- (deposits, salary, banks RPCs, treasury/custody) — and for inventory,
-- everyone currently granted the page gets edit rights immediately once this
-- ships, fixing the reported bug for them too. Going forward the UI always
-- passes an explicit level on insert/upsert.

ALTER TABLE public.employee_page_access
  ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'edit' CHECK (access_level IN ('view', 'edit'));

-- New overload — do NOT touch the existing 1-arg has_page_access(text).
-- Every current SELECT-scope policy keeps calling the 1-arg form and keeps
-- meaning "some access" (view-or-above). Mutating policies/RPCs should call
-- this 2-arg form with p_level = 'edit'.
CREATE OR REPLACE FUNCTION public.has_page_access(p_slug text, p_level text) RETURNS boolean AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.employee_page_access
    WHERE employee_id = public.current_employee_id()
      AND page_slug = p_slug
      AND (p_level = 'view' OR access_level = 'edit')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

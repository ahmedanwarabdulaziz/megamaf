-- ============================================================
-- Restore project_id to expenses
-- ============================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

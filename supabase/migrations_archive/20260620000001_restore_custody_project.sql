-- ============================================================
-- Restore project_id to employee_custodies
-- ============================================================

ALTER TABLE public.employee_custodies
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- Add project_id (optional) to employee_custodies
-- Allows linking a custody item to a specific project

ALTER TABLE public.employee_custodies
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

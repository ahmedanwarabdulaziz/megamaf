-- ============================================================
-- Custody Approval System
-- ============================================================

-- 1. Add approval columns to employee_custodies
ALTER TABLE public.employee_custodies
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Add can_approve_custodies to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS can_approve_custodies boolean NOT NULL DEFAULT false;

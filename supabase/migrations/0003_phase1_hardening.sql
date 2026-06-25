-- ============================================================================
-- 1. Security: Create employee_secrets to protect PINs
-- ============================================================================

CREATE TABLE public.employee_secrets (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  pin_hash text,
  failed_pin_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- Migrate existing data
INSERT INTO public.employee_secrets (employee_id, pin_hash, failed_pin_attempts, locked_until)
SELECT id, pin_hash, failed_pin_attempts, locked_until
FROM public.employees;

-- Drop insecure columns from employees
ALTER TABLE public.employees 
  DROP COLUMN pin_hash, 
  DROP COLUMN failed_pin_attempts, 
  DROP COLUMN locked_until;

-- Enable RLS with NO policies for authenticated users (Service Role only)
ALTER TABLE public.employee_secrets ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Security: Views must respect RLS (security_invoker)
-- ============================================================================

ALTER VIEW public.v_project_financial_position SET (security_invoker = true);

-- ============================================================================
-- 3. Performance: Add missing indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_employees_auth_user_id ON public.employees(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_parent_id ON public.projects(parent_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON public.projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_epa_project_id ON public.employee_project_access(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_employee_id ON public.audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by ON public.attachments(uploaded_by);

-- ============================================================================
-- 4. Correctness: Protect Main Company from closure or deletion
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_main_company()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_main = true THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'لا يمكن حذف الشركة الرئيسية';
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'closed' THEN
      RAISE EXCEPTION 'لا يمكن إغلاق الشركة الرئيسية';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_main_company
  BEFORE UPDATE OR DELETE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_main_company();

-- ============================================================================
-- 5. Correctness: Auto updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_updated_at_employees BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_projects BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_project_owners BEFORE UPDATE ON public.project_owners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_app_settings BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_user_credentials BEFORE UPDATE ON public.user_credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at_employee_secrets BEFORE UPDATE ON public.employee_secrets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 6. Access Scope: Cascade project access to subtree (Recursive)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id uuid) RETURNS boolean AS $$
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id FROM public.projects WHERE id = p_project_id
    UNION ALL
    SELECT p.id, p.parent_id FROM public.projects p
    JOIN ancestors a ON p.id = a.parent_id
  )
  SELECT EXISTS (
    SELECT 1 FROM public.employee_project_access epa
    WHERE epa.employee_id = public.current_employee_id()
      AND epa.project_id IN (SELECT id FROM ancestors)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================================
-- 7. Audit Log: Harden insertion
-- ============================================================================

DROP POLICY IF EXISTS "Audit log insertable by all" ON public.audit_log;

CREATE POLICY "Audit log insertable by all" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (employee_id = public.current_employee_id());

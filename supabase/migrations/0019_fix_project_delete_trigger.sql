-- 0019_fix_project_delete_trigger.sql
-- Fix: protect_main_company trigger was returning NEW on DELETE operations,
-- but NEW is NULL on DELETE triggers in PostgreSQL — this silently cancelled
-- every non-main-company delete. Must return OLD for DELETE, NEW for UPDATE.

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

  -- BEFORE DELETE triggers must return OLD (not NEW which is NULL)
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

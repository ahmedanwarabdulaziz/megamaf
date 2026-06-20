-- ============================================================
-- 10. WAREHOUSES TABLE
-- ============================================================
CREATE TABLE public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_main boolean NOT NULL DEFAULT false,
  location text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER set_warehouses_updated_at
BEFORE UPDATE ON public.warehouses
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read warehouses in their company"
  ON public.warehouses FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "Users can insert warehouses in their company"
  ON public.warehouses FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Users can update warehouses in their company"
  ON public.warehouses FOR UPDATE
  USING (company_id = get_my_company_id());

CREATE POLICY "Admins can delete warehouses in their company"
  ON public.warehouses FOR DELETE
  USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

-- Trigger to automatically create a main warehouse when a project is created
CREATE OR REPLACE FUNCTION public.create_main_warehouse_for_project()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.warehouses (company_id, project_id, name, is_main)
  VALUES (NEW.company_id, NEW.id, 'المخزن الرئيسي', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_project_created_warehouse
AFTER INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.create_main_warehouse_for_project();

-- Backfill: Create main warehouse for all existing projects
INSERT INTO public.warehouses (company_id, project_id, name, is_main)
SELECT company_id, id, 'المخزن الرئيسي', true
FROM public.projects
ON CONFLICT DO NOTHING;

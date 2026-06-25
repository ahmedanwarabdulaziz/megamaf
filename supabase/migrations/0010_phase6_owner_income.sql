-- 0010_phase6_owner_income.sql

-- 1. Create owner_payment_schedule table
CREATE TABLE public.owner_payment_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  expected_amount numeric(18,2) NOT NULL,
  method text,
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'partial', 'paid')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. RLS for owner_payment_schedule
ALTER TABLE public.owner_payment_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_payment_schedule select scoped" ON public.owner_payment_schedule
  FOR SELECT TO authenticated USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "owner_payment_schedule insert scoped" ON public.owner_payment_schedule
  FOR INSERT TO authenticated WITH CHECK (
    (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
    AND (public.is_super_admin() OR public.has_project_access(project_id))
  );

CREATE POLICY "owner_payment_schedule update scoped" ON public.owner_payment_schedule
  FOR UPDATE TO authenticated USING (
    (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
    AND (public.is_super_admin() OR public.has_project_access(project_id))
  );

CREATE POLICY "owner_payment_schedule delete scoped" ON public.owner_payment_schedule
  FOR DELETE TO authenticated USING (
    (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
    AND (public.is_super_admin() OR public.has_project_access(project_id))
  );

-- 3. Trigger to prevent owner claims on main company
CREATE OR REPLACE FUNCTION public.trg_prevent_main_company_owner_claims()
RETURNS TRIGGER AS $$
DECLARE
  v_node_type text;
BEGIN
  IF NEW.claim_type = 'owner' THEN
    SELECT node_type INTO v_node_type FROM public.projects WHERE id = NEW.project_id;
    IF v_node_type = 'main_company' THEN
      RAISE EXCEPTION 'Cannot create an owner claim on the main company node.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER prevent_main_company_owner_claims
BEFORE INSERT OR UPDATE ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_main_company_owner_claims();

-- 4. Re-create v_project_financial_position with real numbers
DROP VIEW IF EXISTS public.v_project_financial_position;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
SELECT 
  p.id as project_id,
  -- Income = Sum of total_due_this_claim for approved owner claims
  COALESCE((
    SELECT SUM(vct.total_due_this_claim) 
    FROM public.claims c 
    JOIN public.v_claim_totals vct ON c.id = vct.claim_id 
    WHERE c.project_id = p.id AND c.claim_type = 'owner' AND c.status = 'approved'
  ), 0) as total_income,
  
  -- Expenses = Sum of approved invoices (total) + Sum of approved vendor claims (total_due_this_claim)
  (
    COALESCE((
      SELECT SUM(total) 
      FROM public.invoices 
      WHERE project_id = p.id AND status = 'approved'
    ), 0) 
    +
    COALESCE((
      SELECT SUM(vct.total_due_this_claim) 
      FROM public.claims c 
      JOIN public.v_claim_totals vct ON c.id = vct.claim_id 
      WHERE c.project_id = p.id AND c.claim_type = 'vendor' AND c.status = 'approved'
    ), 0)
  ) as total_expenses,
  
  -- Balance = Income - Expenses
  (
    COALESCE((
      SELECT SUM(vct.total_due_this_claim) 
      FROM public.claims c 
      JOIN public.v_claim_totals vct ON c.id = vct.claim_id 
      WHERE c.project_id = p.id AND c.claim_type = 'owner' AND c.status = 'approved'
    ), 0)
    -
    (
      COALESCE((
        SELECT SUM(total) 
        FROM public.invoices 
        WHERE project_id = p.id AND status = 'approved'
      ), 0) 
      +
      COALESCE((
        SELECT SUM(vct.total_due_this_claim) 
        FROM public.claims c 
        JOIN public.v_claim_totals vct ON c.id = vct.claim_id 
        WHERE c.project_id = p.id AND c.claim_type = 'vendor' AND c.status = 'approved'
      ), 0)
    )
  ) as balance
FROM public.projects p;

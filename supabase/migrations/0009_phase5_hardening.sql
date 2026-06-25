-- 0009_phase5_hardening.sql

-- 1. Create payment_allocations table (minimal for Phase 7)
CREATE TABLE public.payment_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id uuid REFERENCES public.claims(id) ON DELETE CASCADE,
    allocated_amount numeric(18,2) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allocations viewable by all authenticated" ON public.payment_allocations FOR SELECT TO authenticated USING (true);

-- 2. Create v_claim_paid view
CREATE OR REPLACE VIEW public.v_claim_paid WITH (security_invoker = true) AS
SELECT 
    c.id as claim_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.claims c
LEFT JOIN public.payment_allocations pa ON pa.claim_id = c.id
GROUP BY c.id;

-- 3. Update v_claim_totals with security_invoker = true and LATERAL optimization
CREATE OR REPLACE VIEW public.v_claim_totals WITH (security_invoker = true) AS
WITH item_math AS (
  SELECT 
    ci.claim_id,
    ci.item_ref,
    ci.previous_qty,
    ci.current_qty,
    ci.unit_price,
    ci.disbursement_pct,
    (ci.previous_qty + ci.current_qty) * ci.unit_price AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct) AS cumulative_retained
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT 
    claim_id,
    SUM(cumulative_line_total) as claim_cumulative_total,
    SUM(cumulative_payable) as claim_cumulative_payable,
    SUM(cumulative_retained) as claim_cumulative_retained
  FROM item_math
  GROUP BY claim_id
)
SELECT 
  c.id as claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  COALESCE(prior.amount, 0) as prior_cumulative_payable,
  (cs.claim_cumulative_payable - COALESCE(prior.amount, 0)) as net_payable_before_tax,
  CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable - COALESCE(prior.amount, 0)) * c.tax_rate
  ELSE 0 END as tax_amount,
  (cs.claim_cumulative_payable - COALESCE(prior.amount, 0)) + CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable - COALESCE(prior.amount, 0)) * c.tax_rate
  ELSE 0 END as total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs ON cs.claim_id = c.id
LEFT JOIN LATERAL (
  SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct) as amount
  FROM public.claims pc
  JOIN public.claim_items pci ON pci.claim_id = pc.id
  WHERE pc.project_id = c.project_id AND pc.party_id = c.party_id AND pc.claim_number < c.claim_number AND pc.status = 'approved' AND pc.claim_type = c.claim_type
) prior ON true;

-- 4. Replace RPCs to add project scoping and auditing
CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_project_id uuid;
BEGIN
  SELECT status, project_id INTO v_status, v_project_id FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve invoices';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'approved', approved_by = public.current_employee_id(), approved_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (public.current_employee_id(), 'approve', 'invoice', p_invoice_id, jsonb_build_object('status', 'approved'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_project_id uuid;
BEGIN
  SELECT status, project_id INTO v_status, v_project_id FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject invoices';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is not pending';
  END IF;

  UPDATE public.invoices
  SET status = 'rejected'
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (public.current_employee_id(), 'reject', 'invoice', p_invoice_id, jsonb_build_object('status', 'rejected'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_project_id uuid;
BEGIN
  SELECT status, project_id INTO v_status, v_project_id FROM public.claims WHERE id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'approved', approved_by = public.current_employee_id(), approved_at = now()
  WHERE id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (public.current_employee_id(), 'approve', 'claim', p_claim_id, jsonb_build_object('status', 'approved'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
  v_project_id uuid;
BEGIN
  SELECT status, project_id INTO v_status, v_project_id FROM public.claims WHERE id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject claims';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET status = 'rejected'
  WHERE id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (public.current_employee_id(), 'reject', 'claim', p_claim_id, jsonb_build_object('status', 'rejected'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Release Retention RPC
CREATE OR REPLACE FUNCTION public.release_retention(p_claim_id uuid, p_amount numeric, p_notes text)
RETURNS uuid AS $$
DECLARE
    v_project_id uuid;
    v_status text;
    v_retention_id uuid;
BEGIN
    SELECT project_id, status INTO v_project_id, v_status FROM public.claims WHERE id = p_claim_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
    IF v_status != 'approved' THEN RAISE EXCEPTION 'Claim must be approved to release retention'; END IF;

    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to release retention';
    END IF;

    IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized on this project';
    END IF;

    INSERT INTO public.retention_releases (claim_id, release_date, release_amount, notes, status, created_by)
    VALUES (p_claim_id, CURRENT_DATE, p_amount, p_notes, 'pending', public.current_employee_id())
    RETURNING id INTO v_retention_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'retention_release', v_retention_id, jsonb_build_object('claim_id', p_claim_id, 'amount', p_amount));

    RETURN v_retention_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update retention RLS policy
DROP POLICY IF EXISTS "Retention insert scoped" ON public.retention_releases;
CREATE POLICY "Retention insert scoped" ON public.retention_releases
  FOR INSERT TO authenticated WITH CHECK (
    (public.is_super_admin() OR (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()))
    AND (public.is_super_admin() OR public.has_project_access(project_id))
  );

-- 0011_phase6_hardening.sql

-- FIX 1: rewrite release_retention to use correct columns of retention_releases
CREATE OR REPLACE FUNCTION public.release_retention(p_claim_id uuid, p_amount numeric, p_notes text)
RETURNS uuid AS $$
DECLARE
    v_project_id uuid;
    v_status text;
    v_claim_type text;
    v_party_id uuid;
    v_retention_id uuid;
BEGIN
    SELECT project_id, status, claim_type, party_id 
    INTO v_project_id, v_status, v_claim_type, v_party_id 
    FROM public.claims WHERE id = p_claim_id;
    
    IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
    IF v_status != 'approved' THEN RAISE EXCEPTION 'Claim must be approved to release retention'; END IF;

    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to release retention';
    END IF;

    IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized on this project';
    END IF;

    INSERT INTO public.retention_releases (claim_type, party_id, project_id, amount, released_by, notes)
    VALUES (v_claim_type, v_party_id, v_project_id, p_amount, public.current_employee_id(), p_notes)
    RETURNING id INTO v_retention_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'retention_release', v_retention_id, jsonb_build_object('claim_id', p_claim_id, 'amount', p_amount));

    RETURN v_retention_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FIX 4: Add set_updated_at trigger to owner_payment_schedule
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.owner_payment_schedule
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

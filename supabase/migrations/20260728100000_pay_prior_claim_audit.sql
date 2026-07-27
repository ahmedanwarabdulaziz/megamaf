-- 20260728100000_pay_prior_claim_audit.sql
--
-- pay_prior_claim() updates a vendor's prior-claim paid amount but never
-- wrote an audit_log row — unlike every sibling payment RPC in
-- 20260727130400_fix_treasury_slug.sql (record_vendor_payment,
-- assign_owner_receipt, record_vendor_payment_from_expense,
-- assign_vendor_payment), which all log. Add the same audit insert here.

CREATE OR REPLACE FUNCTION public.pay_prior_claim(
    p_prior_claim_id uuid,
    p_vendor_id      uuid,
    p_amount         numeric
) RETURNS void AS $$
DECLARE
    v_certified  numeric;
    v_paid       numeric;
    v_project_id uuid;
    v_party_id   uuid;
BEGIN
    -- Authorization
    IF NOT public.is_super_admin() AND NOT public.has_page_access('treasury', 'edit') THEN
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    SELECT vendor_id, project_id, prior_certified_amount, prior_paid_amount
    INTO v_party_id, v_project_id, v_certified, v_paid
    FROM public.vendor_prior_claims
    WHERE id = p_prior_claim_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Prior claim % not found', p_prior_claim_id;
    END IF;
    IF v_party_id != p_vendor_id THEN
        RAISE EXCEPTION 'Prior claim does not belong to vendor %', p_vendor_id;
    END IF;
    IF p_amount > (v_certified - v_paid) THEN
        RAISE EXCEPTION 'Payment amount % exceeds outstanding prior balance %', p_amount, (v_certified - v_paid);
    END IF;

    -- Project access
    IF NOT public.is_super_admin() AND NOT public.has_project_access(v_project_id) THEN
        RAISE EXCEPTION 'Not authorized on project %', v_project_id;
    END IF;

    UPDATE public.vendor_prior_claims
    SET prior_paid_amount = prior_paid_amount + p_amount
    WHERE id = p_prior_claim_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (
        public.current_employee_id(), 'update', 'vendor_prior_claim', p_prior_claim_id,
        jsonb_build_object('vendor_id', p_vendor_id, 'amount', p_amount, 'project_id', v_project_id)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

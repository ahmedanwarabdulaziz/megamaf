-- 20260712110000_revert_claim_to_pending.sql
--
-- There was previously no way to send an approved claim back to 'pending' for
-- correction — only approve_claim and reject_claim existed, and reject_claim
-- actually DELETES the claim (see 0008_phase5_vendors_claims.sql), which is
-- not appropriate when the claim just needs a data fix (e.g. a carried-forward
-- item was edited to the wrong value before approval).
--
-- Super-admin only, mirroring reverse_ledger_entry()'s restriction — this
-- reopens an already-approved financial record, so it's deliberately not
-- available to regular approvers.

CREATE OR REPLACE FUNCTION public.revert_claim_to_pending(p_claim_id uuid)
RETURNS void AS $$
DECLARE
    v_status text;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super admins can revert an approved claim to pending';
    END IF;

    SELECT status INTO v_status FROM public.claims WHERE id = p_claim_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found';
    END IF;
    IF v_status != 'approved' THEN
        RAISE EXCEPTION 'Only an approved claim can be reverted to pending';
    END IF;

    UPDATE public.claims
    SET status = 'pending', approved_by = NULL, approved_at = NULL
    WHERE id = p_claim_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before, after)
    VALUES (
        public.current_employee_id(), 'update', 'claim', p_claim_id,
        jsonb_build_object('status', 'approved'),
        jsonb_build_object('status', 'pending')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

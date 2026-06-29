-- 0038_reject_claim_deletes.sql
--
-- Business rule change: rejecting a claim DELETES it entirely and reverts
-- the system to the previous approved claim. There is no "rejected" status.
-- This also fixes the audit_log constraint issue — we use action='delete'
-- which is already in the allowed list, so no constraint change needed.

CREATE OR REPLACE FUNCTION public.reject_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status     text;
  v_project_id uuid;
  v_party_id   uuid;
  v_claim_num  int;
BEGIN
  SELECT status, project_id, party_id, claim_number
    INTO v_status, v_project_id, v_party_id, v_claim_num
    FROM public.claims
   WHERE id = p_claim_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim not found';
  END IF;

  IF NOT (
    SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()
  ) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to reject claims';
  END IF;

  IF NOT public.has_project_access(v_project_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Only pending claims can be rejected/deleted';
  END IF;

  -- Log the deletion BEFORE deleting (so audit record references a still-existing claim)
  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before)
  VALUES (
    public.current_employee_id(),
    'delete',
    'claim',
    p_claim_id,
    jsonb_build_object(
      'claim_number', v_claim_num,
      'party_id',     v_party_id,
      'project_id',   v_project_id,
      'status',       v_status,
      'reason',       'rejected — claim deleted and reverted to previous'
    )
  );

  -- Delete the claim; cascades to claim_items → claim_item_stock_bundles, attachments, etc.
  DELETE FROM public.claims WHERE id = p_claim_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

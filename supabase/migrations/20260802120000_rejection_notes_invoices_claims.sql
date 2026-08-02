-- 20260802120000_rejection_notes_invoices_claims.sql
--
-- Adds a rejection note to invoices and claims, mirroring what expenses
-- already do (see 20260723130000_add_expense_rejection_reason.sql), so the
-- submitter can see why their document was rejected.
--
-- Invoices: same pattern as expenses — the row stays with status='rejected'
-- and a rejection_reason. Editing an invoice already resets it to 'pending'
-- (lib/actions/invoices.ts updateInvoice), so we also clear the reason there.
--
-- Claims: rejecting a claim currently DELETES it entirely (0038_reject_claim
-- _deletes.sql) — there is no surviving row to attach a note to. Per request,
-- instead of touching that deletion/renumbering logic (kept as-is to avoid
-- any risk to live data), reject_claim now keeps the claim in place — it was
-- already 'pending' and stays 'pending' — and just tags it with the
-- rejection reason so the submitter sees it and can edit/correct in place.
-- Both functions get a new overload (extra p_reason param, like
-- reject_expense did) rather than replacing the existing single-arg
-- signature, so nothing that might still call the old signature breaks.

-- ── Invoices ────────────────────────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE OR REPLACE FUNCTION public.reject_invoice(p_invoice_id uuid, p_reason text DEFAULT NULL)
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
  SET status = 'rejected', rejection_reason = p_reason
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (public.current_employee_id(), 'reject', 'invoice', p_invoice_id, jsonb_build_object('status', 'rejected', 'rejection_reason', p_reason));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Claims ──────────────────────────────────────────────────────────────
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE OR REPLACE FUNCTION public.reject_claim(p_claim_id uuid, p_reason text DEFAULT NULL)
RETURNS void AS $$
DECLARE
  v_status     text;
  v_project_id uuid;
BEGIN
  SELECT status, project_id
    INTO v_status, v_project_id
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
    RAISE EXCEPTION 'Only pending claims can be rejected';
  END IF;

  -- Keep the claim (status stays 'pending') and tag it with the rejection
  -- reason instead of deleting it, so the submitter can see why and correct
  -- it in place. No stock/ledger movement has happened yet for a pending
  -- claim (that only happens on approve_claim), so there is nothing to undo.
  UPDATE public.claims
  SET rejection_reason = p_reason
  WHERE id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (
    public.current_employee_id(),
    'reject',
    'claim',
    p_claim_id,
    jsonb_build_object('rejection_reason', p_reason)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

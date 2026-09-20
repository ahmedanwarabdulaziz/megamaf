-- 20260920120000_delete_vendor.sql
--
-- Allow deleting a vendor / contractor that was added by mistake — but ONLY if
-- it has no transactions at all.
--
-- Why a database function instead of a plain DELETE from the app:
--   * The tables that record a vendor's activity mostly point at it WITHOUT a
--     foreign key: claims (party_id) and ledger_entries (counterparty_id) are
--     generic, and vendor_prior_claims is ON DELETE CASCADE, so a plain DELETE
--     would happily erase a vendor that has claims/payments, or silently wipe
--     its opening balance. The check therefore has to be explicit.
--   * Row-level security limits what a normal session can SEE (claims and
--     payments are scoped by project access). A check run from the app could
--     miss a transaction in a project the deleting user has no access to and
--     wrongly allow the delete. This function is SECURITY DEFINER, so it sees
--     every row, and the check + delete happen in one transaction.
--
-- "Transaction" = anything financial or documentary tied to the vendor:
--   claims (incl. claim #0), invoices, retention releases, ledger entries
--   (payments), opening-balance prior claims, and vendor payment requests
--   (any status). The vendor's project-scoping rows (vendor_project_access)
--   are not transactions and are removed with it (existing ON DELETE CASCADE).
--
-- Authorization: SUPER ADMIN ONLY. Deleting is permanent, so it is stricter than
-- editing a vendor (which approvers can also do).

CREATE OR REPLACE FUNCTION public.delete_vendor(p_vendor_id uuid) RETURNS void AS $$
DECLARE
    v_employee_id uuid;
    v_vendor      record;
    v_claims      integer;
    v_invoices    integer;
    v_retentions  integer;
    v_ledger      integer;
    v_prior       integer;
    v_requests    integer;
    v_found       text[] := ARRAY[]::text[];
BEGIN
    v_employee_id := public.current_employee_id();

    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only a super admin can delete vendors';
    END IF;

    SELECT * INTO v_vendor FROM public.vendors WHERE id = p_vendor_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'المقاول / المورد غير موجود';
    END IF;

    SELECT count(*) INTO v_claims     FROM public.claims             WHERE claim_type = 'vendor' AND party_id = p_vendor_id;
    SELECT count(*) INTO v_invoices   FROM public.invoices           WHERE vendor_id = p_vendor_id;
    SELECT count(*) INTO v_retentions FROM public.retention_releases WHERE claim_type = 'vendor' AND party_id = p_vendor_id;
    SELECT count(*) INTO v_ledger     FROM public.ledger_entries     WHERE counterparty_type = 'vendor' AND counterparty_id = p_vendor_id;
    SELECT count(*) INTO v_prior      FROM public.vendor_prior_claims WHERE vendor_id = p_vendor_id;
    SELECT count(*) INTO v_requests   FROM public.vendor_payment_requests WHERE vendor_id = p_vendor_id;

    IF v_claims     > 0 THEN v_found := v_found || format('مستخلصات (%s)', v_claims); END IF;
    IF v_invoices   > 0 THEN v_found := v_found || format('فواتير (%s)', v_invoices); END IF;
    IF v_retentions > 0 THEN v_found := v_found || format('إفراج محتجز (%s)', v_retentions); END IF;
    IF v_ledger     > 0 THEN v_found := v_found || format('دفعات (%s)', v_ledger); END IF;
    IF v_prior      > 0 THEN v_found := v_found || format('رصيد افتتاحي (%s)', v_prior); END IF;
    IF v_requests   > 0 THEN v_found := v_found || format('طلبات دفع (%s)', v_requests); END IF;

    IF array_length(v_found, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'لا يمكن حذف "%" لوجود معاملات مسجلة عليه: %', v_vendor.name, array_to_string(v_found, '، ');
    END IF;

    DELETE FROM public.vendors WHERE id = p_vendor_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before)
    VALUES (v_employee_id, 'delete', 'vendor', p_vendor_id, to_jsonb(v_vendor));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.delete_vendor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_vendor(uuid) TO authenticated;

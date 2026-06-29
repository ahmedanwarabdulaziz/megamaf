-- 0037_fix_audit_log_action_check.sql
--
-- The original constraint (0001) did not include 'reject', but several RPCs
-- (reject_claim, reject_invoice, reject_expense) write action='reject' to the
-- audit_log table. This migration widens the allowed set to include 'reject'.

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check CHECK (
    action IN ('create', 'update', 'delete', 'approve', 'reject', 'login', 'logout')
  );

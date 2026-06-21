-- ============================================================
-- Add bank_account_id to project_funds
-- When a fund is added, it records a deposit in the selected bank account.
-- ============================================================
ALTER TABLE public.project_funds
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL;

-- 0047_allow_opening_balance_allocation.sql

-- Update the check constraint to allow allocating payments to opening balances
ALTER TABLE public.payment_allocations 
  DROP CONSTRAINT IF EXISTS payment_allocations_target_type_check;

ALTER TABLE public.payment_allocations 
  ADD CONSTRAINT payment_allocations_target_type_check 
  CHECK (target_type IN ('invoice', 'claim', 'retention_release', 'owner_schedule', 'project_opening_balance', 'vendor_opening_balance'));

-- View to track how much of a project opening balance (owner income) has been paid
CREATE OR REPLACE VIEW public.v_project_opening_balance_paid WITH (security_invoker = true) AS
SELECT 
    ob.id AS opening_balance_id,
    COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
FROM public.project_opening_balances ob
LEFT JOIN public.payment_allocations pa 
       ON pa.target_id = ob.id 
      AND pa.target_type = 'project_opening_balance'
GROUP BY ob.id;

-- View to track how much of a vendor opening balance has been paid
CREATE OR REPLACE VIEW public.v_vendor_opening_balance_paid WITH (security_invoker = true) AS
SELECT 
    vpc.id AS opening_balance_id,
    COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
FROM public.vendor_prior_claims vpc
LEFT JOIN public.payment_allocations pa 
       ON pa.target_id = vpc.id 
      AND pa.target_type = 'vendor_opening_balance'
GROUP BY vpc.id;

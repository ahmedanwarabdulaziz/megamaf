-- Phase 2 Projects Database Setup

-- Create a financial position view stub. 
-- In later phases (Ledger & Claims), this view will aggregate real financial data.
-- For now, it provides a stable API for the UI to consume.

CREATE OR REPLACE VIEW public.v_project_financial_position AS
SELECT 
    id as project_id,
    0.0 as total_income,
    0.0 as total_expenses,
    0.0 as balance
FROM public.projects;

-- Note: The base tables `projects` and `project_owners` 
-- along with their RLS policies were already created in 0001_phase1_foundation.sql

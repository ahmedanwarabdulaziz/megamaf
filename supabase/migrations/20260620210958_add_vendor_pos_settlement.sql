-- Migration: add_vendor_pos_settlement
-- Adds settlement tracking columns to vendor_pos

ALTER TABLE public.vendor_pos
ADD COLUMN settled_at timestamp with time zone,
ADD COLUMN settled_by_expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL;

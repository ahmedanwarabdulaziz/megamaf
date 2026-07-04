-- Add unit column to claim_items for reference (e.g. طن، متر مربع، عدد)
ALTER TABLE public.claim_items ADD COLUMN IF NOT EXISTS unit text;

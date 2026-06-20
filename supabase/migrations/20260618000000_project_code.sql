ALTER TABLE public.projects ADD COLUMN code text;

-- Generate a code for existing projects based on their name or ID
UPDATE public.projects SET code = 'PRJ-' || left(id::text, 4) WHERE code IS NULL;

-- Now make it NOT NULL
ALTER TABLE public.projects ALTER COLUMN code SET NOT NULL;

-- Make it unique within a company
ALTER TABLE public.projects ADD CONSTRAINT projects_company_code_key UNIQUE (company_id, code);

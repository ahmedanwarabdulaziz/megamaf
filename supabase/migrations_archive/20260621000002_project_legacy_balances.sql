CREATE TABLE IF NOT EXISTS public.project_legacy_balances (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE UNIQUE,
    legacy_paid_custodies numeric(15,2) NOT NULL DEFAULT 0,
    legacy_vendor_payments numeric(15,2) NOT NULL DEFAULT 0,
    legacy_funds numeric(15,2) NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT project_legacy_balances_pkey PRIMARY KEY (id)
);

-- RLS
ALTER TABLE public.project_legacy_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view legacy balances for their company" ON public.project_legacy_balances
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can insert legacy balances for their company" ON public.project_legacy_balances
    FOR INSERT WITH CHECK (
        company_id IN (
            SELECT company_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can update legacy balances for their company" ON public.project_legacy_balances
    FOR UPDATE USING (
        company_id IN (
            SELECT company_id FROM public.profiles WHERE id = auth.uid()
        )
    ) WITH CHECK (
        company_id IN (
            SELECT company_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can delete legacy balances for their company" ON public.project_legacy_balances
    FOR DELETE USING (
        company_id IN (
            SELECT company_id FROM public.profiles WHERE id = auth.uid()
        )
    );

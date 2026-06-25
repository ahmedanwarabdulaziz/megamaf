-- 0012_phase7_treasury_payments.sql

-- 1. Redefine payment_allocations to be polymorphic and link to ledger_entries
DROP VIEW IF EXISTS public.v_claim_paid CASCADE;
DROP TABLE IF EXISTS public.payment_allocations CASCADE;

CREATE TABLE public.payment_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_entry_id uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE CASCADE,
    target_type text NOT NULL CHECK (target_type IN ('invoice', 'claim', 'retention_release', 'owner_schedule')),
    target_id uuid NOT NULL,
    allocated_amount numeric(18,2) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allocations viewable by all authenticated" ON public.payment_allocations FOR SELECT TO authenticated USING (true);

-- 2. Create Views for Paid Amounts
CREATE OR REPLACE VIEW public.v_claim_paid WITH (security_invoker = true) AS
SELECT 
    c.id as claim_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.claims c
LEFT JOIN public.payment_allocations pa ON pa.target_id = c.id AND pa.target_type = 'claim'
GROUP BY c.id;

CREATE OR REPLACE VIEW public.v_invoice_paid WITH (security_invoker = true) AS
SELECT 
    i.id as invoice_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.invoices i
LEFT JOIN public.payment_allocations pa ON pa.target_id = i.id AND pa.target_type = 'invoice'
GROUP BY i.id;

CREATE OR REPLACE VIEW public.v_retention_paid WITH (security_invoker = true) AS
SELECT 
    r.id as retention_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.retention_releases r
LEFT JOIN public.payment_allocations pa ON pa.target_id = r.id AND pa.target_type = 'retention_release'
GROUP BY r.id;

CREATE OR REPLACE VIEW public.v_owner_schedule_paid WITH (security_invoker = true) AS
SELECT 
    s.id as schedule_id,
    COALESCE(SUM(pa.allocated_amount), 0) as paid_amount
FROM public.owner_payment_schedule s
LEFT JOIN public.payment_allocations pa ON pa.target_id = s.id AND pa.target_type = 'owner_schedule'
GROUP BY s.id;

-- 3. Account Statements Views
CREATE OR REPLACE VIEW public.v_vendor_account WITH (security_invoker = true) AS
WITH vendor_docs AS (
    -- Invoices
    SELECT 
        i.vendor_id as party_id, i.project_id, i.invoice_date as document_date, 
        'invoice' as document_type, i.id as document_id, 
        ('Invoice #' || i.id::text) as description, 
        i.total as amount_due, 0 as amount_paid,
        i.created_at
    FROM public.invoices i
    WHERE i.status = 'approved'
    
    UNION ALL
    
    -- Vendor Claims
    SELECT 
        c.party_id, c.project_id, c.claim_date as document_date, 
        'claim' as document_type, c.id as document_id, 
        ('Vendor Claim #' || c.claim_number::text) as description, 
        (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id) as amount_due, 
        0 as amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved' AND c.claim_type = 'vendor'

    UNION ALL
    
    -- Retention Releases
    SELECT 
        r.party_id, r.project_id, r.released_at::date as document_date, 
        'retention_release' as document_type, r.id as document_id, 
        'Retention Release' as description, 
        r.amount as amount_due, 
        0 as amount_paid,
        r.created_at
    FROM public.retention_releases r
    WHERE r.claim_type = 'vendor'

    UNION ALL
    
    -- Ledger Entries (Payments)
    SELECT 
        le.counterparty_id as party_id, le.project_id, le.entry_date as document_date, 
        'payment' as document_type, le.id as document_id, 
        COALESCE(le.memo, 'Payment') as description, 
        0 as amount_due, 
        le.amount as amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'vendor' AND le.direction = 'out'
)
SELECT 
    d.party_id,
    d.project_id,
    p.name as project_name,
    d.document_date,
    d.document_type,
    d.document_id,
    d.description,
    d.amount_due,
    d.amount_paid,
    d.created_at,
    SUM(d.amount_due - d.amount_paid) OVER (
        PARTITION BY d.party_id 
        ORDER BY d.document_date ASC, d.created_at ASC
    ) as running_balance
FROM vendor_docs d
LEFT JOIN public.projects p ON d.project_id = p.id;

CREATE OR REPLACE VIEW public.v_owner_account WITH (security_invoker = true) AS
WITH owner_docs AS (
    -- Owner Claims
    SELECT 
        c.party_id, c.project_id, c.claim_date as document_date, 
        'claim' as document_type, c.id as document_id, 
        ('Owner Claim #' || c.claim_number::text) as description, 
        (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id) as amount_due, 
        0 as amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved' AND c.claim_type = 'owner'
    
    UNION ALL

    -- Ledger Entries (Receipts)
    SELECT 
        le.counterparty_id as party_id, le.project_id, le.entry_date as document_date, 
        'receipt' as document_type, le.id as document_id, 
        COALESCE(le.memo, 'Receipt') as description, 
        0 as amount_due, 
        le.amount as amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'owner' AND le.direction = 'in'
)
SELECT 
    d.party_id,
    d.project_id,
    p.name as project_name,
    d.document_date,
    d.document_type,
    d.document_id,
    d.description,
    d.amount_due,
    d.amount_paid,
    d.created_at,
    SUM(d.amount_due - d.amount_paid) OVER (
        PARTITION BY d.party_id 
        ORDER BY d.document_date ASC, d.created_at ASC
    ) as running_balance
FROM owner_docs d
LEFT JOIN public.projects p ON d.project_id = p.id;

-- 4. Update v_project_financial_position to include cash
DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;
CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
SELECT 
    p.id AS project_id,
    p.name,
    p.code,
    
    -- Billed Income (Owner claims approved)
    COALESCE(SUM(
        CASE WHEN c.claim_type = 'owner' AND c.status = 'approved' THEN
            (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
        ELSE 0 END
    ), 0) AS total_income,
    
    -- Cash Received (Ledger entries in from owner)
    COALESCE((
        SELECT SUM(le.amount) 
        FROM public.ledger_entries le 
        WHERE le.project_id = p.id AND le.counterparty_type = 'owner' AND le.direction = 'in'
    ), 0) AS total_received,

    -- Billed Expense (Vendor claims approved + Invoices approved)
    COALESCE(SUM(
        CASE WHEN c.claim_type = 'vendor' AND c.status = 'approved' THEN
            (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
        ELSE 0 END
    ), 0) + 
    COALESCE((
        SELECT SUM(i.total) 
        FROM public.invoices i 
        WHERE i.project_id = p.id AND i.status = 'approved'
    ), 0) AS total_expenses,
    
    -- Cash Paid (Ledger entries out to vendor)
    COALESCE((
        SELECT SUM(le.amount) 
        FROM public.ledger_entries le 
        WHERE le.project_id = p.id AND le.counterparty_type = 'vendor' AND le.direction = 'out'
    ), 0) AS total_paid,

    -- Retention Held
    COALESCE(SUM(
        CASE WHEN c.claim_type = 'vendor' AND c.status = 'approved' THEN
            (SELECT claim_cumulative_retained FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
        ELSE 0 END
    ), 0) -
    COALESCE((
        SELECT SUM(r.amount)
        FROM public.retention_releases r
        WHERE r.project_id = p.id AND r.claim_type = 'vendor'
    ), 0) AS retention_held,

    -- Balance (Billed Income - Billed Expense)
    COALESCE(SUM(
        CASE WHEN c.claim_type = 'owner' AND c.status = 'approved' THEN
            (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
        ELSE 0 END
    ), 0) - 
    (
      COALESCE(SUM(
          CASE WHEN c.claim_type = 'vendor' AND c.status = 'approved' THEN
              (SELECT total_due_this_claim FROM public.v_claim_totals vct WHERE vct.claim_id = c.id)
          ELSE 0 END
      ), 0) + 
      COALESCE((
          SELECT SUM(i.total) 
          FROM public.invoices i 
          WHERE i.project_id = p.id AND i.status = 'approved'
      ), 0)
    ) AS balance

FROM public.projects p
LEFT JOIN public.claims c ON c.project_id = p.id
GROUP BY p.id, p.name, p.code;

-- 5. RPCs for Recording Payments & Receipts
CREATE OR REPLACE FUNCTION public.record_vendor_payment(
    p_bank_account_id uuid,
    p_vendor_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb -- Array of { target_type, target_id, amount }
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
BEGIN
    -- Authorization
    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        -- TODO: or has_page_access('treasury')
        RAISE EXCEPTION 'Not authorized to record payments';
    END IF;

    -- Validate allocations sum <= amount
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_total_allocated := v_total_allocated + (v_alloc->>'amount')::numeric;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed payment amount';
    END IF;

    -- Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'out', p_amount, 'vendor_payment', p_bank_account_id, 'vendor', p_vendor_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        IF (v_alloc->>'amount')::numeric > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_alloc->>'target_type', (v_alloc->>'target_id')::uuid, (v_alloc->>'amount')::numeric
            );
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'vendor_payment', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.record_owner_receipt(
    p_bank_account_id uuid,
    p_owner_id uuid,
    p_amount numeric,
    p_memo text,
    p_allocations jsonb -- Array of { target_type, target_id, amount }
) RETURNS uuid AS $$
DECLARE
    v_ledger_id uuid;
    v_alloc jsonb;
    v_total_allocated numeric := 0;
BEGIN
    -- Authorization
    IF NOT (SELECT can_approve FROM public.employees WHERE id = public.current_employee_id()) AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Not authorized to record receipts';
    END IF;

    -- Validate allocations sum <= amount
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_total_allocated := v_total_allocated + (v_alloc->>'amount')::numeric;
    END LOOP;

    IF v_total_allocated > p_amount THEN
        RAISE EXCEPTION 'Total allocated amount cannot exceed receipt amount';
    END IF;

    -- Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        entry_date, direction, amount, category, bank_account_id, counterparty_type, counterparty_id, memo, created_by
    ) VALUES (
        CURRENT_DATE, 'in', p_amount, 'owner_payment', p_bank_account_id, 'owner', p_owner_id, p_memo, public.current_employee_id()
    ) RETURNING id INTO v_ledger_id;

    -- Insert Allocations
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        IF (v_alloc->>'amount')::numeric > 0 THEN
            INSERT INTO public.payment_allocations (
                ledger_entry_id, target_type, target_id, allocated_amount
            ) VALUES (
                v_ledger_id, v_alloc->>'target_type', (v_alloc->>'target_id')::uuid, (v_alloc->>'amount')::numeric
            );

            -- If target is owner_schedule, we should eventually update its status.
            -- Using a trigger or handling it here.
            IF v_alloc->>'target_type' = 'owner_schedule' THEN
                -- We'll just set it to 'partial' or 'paid' based on sum.
                -- For now, let's let the application or view handle this or do a quick update.
                -- Phase 7 says "update owner_payment_schedule.status (expected->partial->paid)"
                UPDATE public.owner_payment_schedule ops
                SET status = CASE 
                    WHEN (SELECT COALESCE(SUM(allocated_amount), 0) FROM public.payment_allocations WHERE target_id = ops.id AND target_type = 'owner_schedule') >= ops.expected_amount THEN 'paid'
                    ELSE 'partial'
                END
                WHERE id = (v_alloc->>'target_id')::uuid;
            END IF;
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (public.current_employee_id(), 'create', 'owner_receipt', v_ledger_id, jsonb_build_object('amount', p_amount, 'allocations', p_allocations));

    RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Aggregated Balances for Dashboards
CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
SELECT 
    v.id AS vendor_id,
    v.name AS vendor_name,
    COALESCE(SUM(va.amount_due), 0) AS total_due,
    COALESCE(SUM(va.amount_paid), 0) AS total_paid,
    COALESCE(SUM(va.amount_due) - SUM(va.amount_paid), 0) AS balance
FROM public.vendors v
LEFT JOIN public.v_vendor_account va ON va.party_id = v.id
GROUP BY v.id, v.name;

CREATE OR REPLACE VIEW public.v_owner_balances WITH (security_invoker = true) AS
SELECT 
    o.id AS owner_id,
    o.name AS owner_name,
    COALESCE(SUM(oa.amount_due), 0) AS total_due,
    COALESCE(SUM(oa.amount_paid), 0) AS total_paid,
    COALESCE(SUM(oa.amount_due) - SUM(oa.amount_paid), 0) AS balance
FROM public.project_owners o
LEFT JOIN public.v_owner_account oa ON oa.party_id = o.id
GROUP BY o.id, o.name;

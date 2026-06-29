-- 0048_owner_prior_dues.sql
-- Adds prior_owner_dues to project_opening_balances.
-- This represents the TOTAL certified/billed amount the owner owed BEFORE the system started.
-- outstanding_from_owner = prior_owner_dues - prior_owner_income
-- This outstanding amount acts as "Owner Claim #0" (like vendor_prior_claims for vendors).

-- ============================================================================
-- 1. ADD COLUMN
-- ============================================================================

ALTER TABLE public.project_opening_balances
  ADD COLUMN IF NOT EXISTS prior_owner_dues numeric(18,2) NOT NULL DEFAULT 0
    CHECK (prior_owner_dues >= 0);

-- ============================================================================
-- 2. UPDATE upsert_project_opening_balance RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_project_opening_balance(
    p_project_id         uuid,
    p_cutoff_date        date,
    p_prior_expenses     numeric,
    p_prior_owner_income numeric,
    p_prior_owner_dues   numeric DEFAULT 0,
    p_notes              text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_emp_id  uuid;
    v_node    text;
    v_id      uuid;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can set opening balances';
    END IF;

    -- Prevent setting opening balance on main_company
    SELECT node_type INTO v_node FROM public.projects WHERE id = p_project_id;
    IF v_node = 'main_company' THEN
        RAISE EXCEPTION 'Cannot set opening balance on the main company node';
    END IF;

    IF p_prior_expenses < 0 OR p_prior_owner_income < 0 OR p_prior_owner_dues < 0 THEN
        RAISE EXCEPTION 'Opening balance amounts cannot be negative';
    END IF;

    IF p_prior_owner_income > p_prior_owner_dues AND p_prior_owner_dues > 0 THEN
        RAISE EXCEPTION 'الإيرادات المحصّلة لا يمكن أن تتجاوز إجمالي المستحقات';
    END IF;

    v_emp_id := public.current_employee_id();

    INSERT INTO public.project_opening_balances
        (project_id, cutoff_date, prior_expenses, prior_owner_income, prior_owner_dues, notes, created_by)
    VALUES
        (p_project_id, p_cutoff_date, p_prior_expenses, p_prior_owner_income, p_prior_owner_dues, p_notes, v_emp_id)
    ON CONFLICT (project_id) DO UPDATE SET
        cutoff_date        = EXCLUDED.cutoff_date,
        prior_expenses     = EXCLUDED.prior_expenses,
        prior_owner_income = EXCLUDED.prior_owner_income,
        prior_owner_dues   = EXCLUDED.prior_owner_dues,
        notes              = EXCLUDED.notes,
        updated_at         = now()
    RETURNING id INTO v_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'project_opening_balance', p_project_id,
            jsonb_build_object(
                'cutoff_date', p_cutoff_date,
                'prior_expenses', p_prior_expenses,
                'prior_owner_income', p_prior_owner_income,
                'prior_owner_dues', p_prior_owner_dues
            ));

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. REBUILD v_owner_account — include the owner "Claim #0" outstanding balance
-- ============================================================================

DROP VIEW IF EXISTS public.v_owner_balances CASCADE;
DROP VIEW IF EXISTS public.v_owner_account CASCADE;

CREATE OR REPLACE VIEW public.v_owner_account WITH (security_invoker = true) AS
WITH owner_docs AS (
    -- 1. Approved owner claims (what the owner owes us — in-system)
    SELECT
        c.party_id,
        c.project_id,
        c.claim_date                                                                AS document_date,
        'claim'                                                                     AS document_type,
        c.id                                                                        AS document_id,
        ('مستخلص مالك رقم ' || c.claim_number::text)                               AS description,
        COALESCE(
            (SELECT vct.total_due_this_claim
               FROM public.v_claim_totals vct
              WHERE vct.claim_id = c.id),
            0
        )                                                                           AS amount_due,
        0::numeric                                                                  AS amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved'
      AND c.claim_type = 'owner'

    UNION ALL

    -- 2. Ledger receipts (payments collected from the owner)
    SELECT
        le.counterparty_id                                                          AS party_id,
        le.project_id,
        le.entry_date                                                               AS document_date,
        'receipt'                                                                   AS document_type,
        le.id                                                                       AS document_id,
        COALESCE(le.memo, 'قبض من مالك')                                            AS description,
        0::numeric                                                                  AS amount_due,
        le.amount                                                                   AS amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'owner'
      AND le.direction          = 'in'

    UNION ALL

    -- 3. Project Opening Balances — Owner Claim #0 (outstanding = dues - income)
    --    We record amount_due = prior_owner_dues (total owed before system)
    --    and amount_paid = prior_owner_income (already collected before system)
    --    Net effect: running_balance += (prior_owner_dues - prior_owner_income)
    SELECT
        p.owner_id                                                                  AS party_id,
        ob.project_id,
        ob.cutoff_date                                                              AS document_date,
        'opening_balance'                                                           AS document_type,
        ob.id                                                                       AS document_id,
        'رصيد افتتاحي للمشروع (مستخلص #0)'                                         AS description,
        ob.prior_owner_dues                                                         AS amount_due,
        ob.prior_owner_income                                                       AS amount_paid,
        ob.created_at
    FROM public.project_opening_balances ob
    JOIN public.projects p ON p.id = ob.project_id
    WHERE ob.prior_owner_dues > 0
      AND p.owner_id IS NOT NULL
)
SELECT
    d.party_id,
    d.project_id,
    p.name                                                                          AS project_name,
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
    )                                                                               AS running_balance
FROM owner_docs d
LEFT JOIN public.projects p ON p.id = d.project_id;


CREATE OR REPLACE VIEW public.v_owner_balances WITH (security_invoker = true) AS
SELECT
    o.id                                                                            AS owner_id,
    o.name                                                                          AS owner_name,
    COALESCE(SUM(oa.amount_due),  0)                                               AS total_due,
    COALESCE(SUM(oa.amount_paid), 0)                                               AS total_paid,
    COALESCE(SUM(oa.amount_due) - SUM(oa.amount_paid), 0)                         AS balance
FROM public.project_owners o
LEFT JOIN public.v_owner_account oa ON oa.party_id = o.id
GROUP BY o.id, o.name;

-- ============================================================================
-- 4. UPDATE v_project_opening_balance_paid to track payments against owner Claim #0
--    The outstanding = prior_owner_dues - prior_owner_income - payments_received
-- ============================================================================

CREATE OR REPLACE VIEW public.v_project_opening_balance_paid WITH (security_invoker = true) AS
SELECT 
    ob.id AS opening_balance_id,
    ob.prior_owner_dues,
    ob.prior_owner_income,
    COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount,
    -- outstanding = dues - already_collected_before_system - paid_via_system
    ob.prior_owner_dues
      - ob.prior_owner_income
      - COALESCE(SUM(pa.allocated_amount), 0) AS outstanding_amount
FROM public.project_opening_balances ob
LEFT JOIN public.payment_allocations pa 
       ON pa.target_id = ob.id 
      AND pa.target_type = 'project_opening_balance'
GROUP BY ob.id, ob.prior_owner_dues, ob.prior_owner_income;

-- ============================================================================
-- 5. UPDATE v_project_financial_position to include prior_owner_dues
-- ============================================================================

DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;

CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH proj_claims AS (
    SELECT
        c.project_id,
        c.claim_type,
        vct.total_due_this_claim,
        vct.claim_cumulative_retained
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status = 'approved'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(CASE WHEN claim_type = 'owner'  THEN total_due_this_claim     ELSE 0 END) AS owner_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN total_due_this_claim     ELSE 0 END) AS vendor_billed,
        SUM(CASE WHEN claim_type = 'vendor' THEN claim_cumulative_retained ELSE 0 END) AS vendor_retained
    FROM proj_claims
    GROUP BY project_id
),
invoices_agg AS (
    SELECT project_id, SUM(total) AS invoice_total
    FROM public.invoices
    WHERE status = 'approved'
    GROUP BY project_id
),
expenses_agg AS (
    SELECT project_id, SUM(amount) AS total_employee_expenses
    FROM public.expenses
    WHERE status = 'approved'
      AND project_id IS NOT NULL
    GROUP BY project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) AS retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
owner_allocations AS (
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'owner'
    GROUP BY c.project_id
    UNION ALL
    SELECT s.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.owner_payment_schedule s ON s.id = pa.target_id AND pa.target_type = 'owner_schedule'
    GROUP BY s.project_id
    UNION ALL
    -- Include payments received against owner Claim #0
    SELECT ob.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.project_opening_balances ob ON ob.id = pa.target_id AND pa.target_type = 'project_opening_balance'
    GROUP BY ob.project_id
),
owner_cash AS (
    SELECT project_id, SUM(amount) AS total_received
    FROM owner_allocations
    GROUP BY project_id
),
vendor_allocations AS (
    SELECT i.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.target_id AND pa.target_type = 'invoice'
    GROUP BY i.project_id
    UNION ALL
    SELECT c.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.claims c ON c.id = pa.target_id AND pa.target_type = 'claim' AND c.claim_type = 'vendor'
    GROUP BY c.project_id
    UNION ALL
    SELECT r.project_id, SUM(pa.allocated_amount) AS amount
    FROM public.payment_allocations pa
    JOIN public.retention_releases r ON r.id = pa.target_id AND pa.target_type = 'retention_release' AND r.claim_type = 'vendor'
    GROUP BY r.project_id
),
vendor_cash AS (
    SELECT project_id, SUM(amount) AS total_paid
    FROM vendor_allocations
    GROUP BY project_id
),
-- ► Opening balance prior vendor claims total (sum per project, informational)
prior_vendor_claims_agg AS (
    SELECT
        project_id,
        SUM(prior_certified_amount) AS total_prior_certified,
        SUM(prior_paid_amount)      AS total_prior_paid,
        SUM(prior_retention_held)   AS total_prior_retention,
        COUNT(*)                    AS vendor_count
    FROM public.vendor_prior_claims
    GROUP BY project_id
),
-- ► Opening inventory asset value using average cost
inventory_receipts AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END)               AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END) AS total_value_in
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
),
inventory_avg_cost AS (
    SELECT
        ir.project_id,
        ir.item_id,
        CASE WHEN ir.total_qty_in > 0
             THEN ir.total_value_in / ir.total_qty_in
             ELSE 0
        END AS avg_cost
    FROM inventory_receipts ir
),
inventory_on_hand AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(sm.qty) AS qty_on_hand
    FROM public.stock_movements sm
    JOIN public.warehouses w ON w.id = sm.warehouse_id
    WHERE w.project_id IS NOT NULL
    GROUP BY w.project_id, sm.item_id
    HAVING SUM(sm.qty) > 0
),
inventory_asset AS (
    SELECT
        ioh.project_id,
        SUM(ioh.qty_on_hand * iac.avg_cost) AS total_asset_value
    FROM inventory_on_hand ioh
    JOIN inventory_avg_cost iac
      ON iac.project_id = ioh.project_id
     AND iac.item_id    = ioh.item_id
    GROUP BY ioh.project_id
)
SELECT
    p.id   AS project_id,
    p.name,
    p.code,

    -- ► Opening balance metadata
    CASE WHEN ob.id IS NOT NULL THEN true ELSE false END  AS has_opening_balance,
    ob.cutoff_date                                         AS opening_cutoff_date,
    COALESCE(ob.prior_expenses,     0)                     AS prior_expenses,
    COALESCE(ob.prior_owner_income, 0)                     AS prior_owner_income,
    COALESCE(ob.prior_owner_dues,   0)                     AS prior_owner_dues,
    -- outstanding = dues - income (owner Claim #0 net)
    GREATEST(COALESCE(ob.prior_owner_dues, 0) - COALESCE(ob.prior_owner_income, 0), 0) AS prior_owner_outstanding,

    -- ► Vendor prior claims summary (informational)
    COALESCE(pvca.total_prior_certified,  0)               AS prior_vendor_certified,
    COALESCE(pvca.total_prior_paid,       0)               AS prior_vendor_paid,
    COALESCE(pvca.total_prior_retention,  0)               AS prior_vendor_retention,
    COALESCE(pvca.vendor_count,           0)               AS prior_vendor_count,

    -- ► In-system figures
    COALESCE(pca.owner_billed,  0)                         AS in_system_income,
    COALESCE(oc.total_received, 0)                         AS total_received,
    COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS in_system_expenses,
    COALESCE(vc.total_paid, 0)                             AS total_paid,
    COALESCE(pca.vendor_retained, 0)
      - COALESCE(rra.retention_released, 0)               AS retention_held,

    -- ► Inventory asset (items still in warehouse, avg cost)
    COALESCE(ia_asset.total_asset_value, 0)                AS inventory_asset_value,

    -- ► Grand totals
    -- total_income includes prior_owner_dues (the full amount owed by owner before system)
    COALESCE(ob.prior_owner_dues, 0)
      + COALESCE(pca.owner_billed, 0)                      AS total_income,

    COALESCE(ob.prior_expenses, 0)
      + COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS total_expenses,

    -- balance = total_income − total_expenses
    COALESCE(ob.prior_owner_dues, 0)
      + COALESCE(pca.owner_billed, 0)
      - COALESCE(ob.prior_expenses, 0)
      - COALESCE(pca.vendor_billed, 0)
      - COALESCE(ia.invoice_total, 0)
      - COALESCE(ea.total_employee_expenses, 0)            AS balance

FROM public.projects p
LEFT JOIN public.project_opening_balances ob  ON ob.project_id  = p.id
LEFT JOIN proj_claims_agg                 pca ON pca.project_id = p.id
LEFT JOIN invoices_agg                    ia  ON ia.project_id  = p.id
LEFT JOIN expenses_agg                    ea  ON ea.project_id  = p.id
LEFT JOIN retention_releases_agg          rra ON rra.project_id = p.id
LEFT JOIN owner_cash                      oc  ON oc.project_id  = p.id
LEFT JOIN vendor_cash                     vc  ON vc.project_id  = p.id
LEFT JOIN prior_vendor_claims_agg         pvca ON pvca.project_id = p.id
LEFT JOIN inventory_asset                 ia_asset ON ia_asset.project_id = p.id;

-- ============================================================================
-- 6. REBUILD v_claim_totals — add prior_owner_dues as Claim #0 offset for
--    owner claims (mirroring how vendor_prior_claims works for vendor claims)
-- ============================================================================

DROP VIEW IF EXISTS public.v_claim_totals CASCADE;

CREATE OR REPLACE VIEW public.v_claim_totals WITH (security_invoker = true) AS
WITH item_math AS (
  SELECT
    ci.claim_id,
    (ci.previous_qty + ci.current_qty) * ci.unit_price                         AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct   AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct) AS cumulative_retained
  FROM public.claim_items ci
),
claim_sums AS (
  SELECT
    claim_id,
    SUM(cumulative_line_total)  AS claim_cumulative_total,
    SUM(cumulative_payable)     AS claim_cumulative_payable,
    SUM(cumulative_retained)    AS claim_cumulative_retained
  FROM item_math
  GROUP BY claim_id
),
-- Prior in-system cumulative payable from previous approved claims of the same party+project
in_system_prior AS (
  SELECT
    c.id AS claim_id,
    COALESCE(
      (SELECT SUM((pci.previous_qty + pci.current_qty) * pci.unit_price * pci.disbursement_pct)
       FROM public.claims pc
       JOIN public.claim_items pci ON pci.claim_id = pc.id
       WHERE pc.project_id = c.project_id
         AND pc.party_id   = c.party_id
         AND pc.claim_number < c.claim_number
         AND pc.status = 'approved'
         AND pc.claim_type = c.claim_type
      ), 0
    ) AS in_system_prior_payable
  FROM public.claims c
)
SELECT
  c.id                                              AS claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,

  -- prior_cumulative_payable:
  --   vendor claims: in_system_prior + vendor_prior_claims (Claim #0)
  --   owner  claims: in_system_prior + project_opening_balances.prior_owner_dues (Claim #0)
  isp.in_system_prior_payable
    + CASE
        WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
        WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
        ELSE 0
      END                                           AS prior_cumulative_payable,

  -- net payable this claim (before tax)
  cs.claim_cumulative_payable
    - isp.in_system_prior_payable
    - CASE
        WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
        WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
        ELSE 0
      END                                           AS net_payable_before_tax,

  -- tax
  CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable
      - isp.in_system_prior_payable
      - CASE
          WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
          WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
          ELSE 0
        END) * c.tax_rate
  ELSE 0 END                                        AS tax_amount,

  -- total_due_this_claim
  (cs.claim_cumulative_payable
    - isp.in_system_prior_payable
    - CASE
        WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
        WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
        ELSE 0
      END)
  + CASE WHEN c.tax_enabled THEN
      (cs.claim_cumulative_payable
        - isp.in_system_prior_payable
        - CASE
            WHEN c.claim_type = 'vendor' THEN COALESCE(vpc.prior_certified_amount, 0)
            WHEN c.claim_type = 'owner'  THEN COALESCE(ob.prior_owner_dues, 0)
            ELSE 0
          END) * c.tax_rate
    ELSE 0 END                                      AS total_due_this_claim

FROM public.claims c
LEFT JOIN claim_sums  cs  ON cs.claim_id   = c.id
LEFT JOIN in_system_prior isp ON isp.claim_id = c.id
-- Vendor Claim #0 offset
LEFT JOIN public.vendor_prior_claims vpc
       ON vpc.project_id = c.project_id
      AND vpc.vendor_id  = c.party_id
      AND c.claim_type   = 'vendor'
-- Owner Claim #0 offset (project_opening_balances)
LEFT JOIN public.project_opening_balances ob
       ON ob.project_id  = c.project_id
      AND c.claim_type   = 'owner';


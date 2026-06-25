-- 0025_opening_balances.sql
-- Opening Balance / Project Migration Feature
-- Allows recording prior financial history when onboarding an ongoing project.

-- ============================================================================
-- 1. NEW TABLES
-- ============================================================================

-- 1a. project_opening_balances
--     One row per project. Stores lump-sum prior financial figures.
CREATE TABLE public.project_opening_balances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cutoff_date         date NOT NULL,
  prior_expenses      numeric(18,2) NOT NULL DEFAULT 0
                        CHECK (prior_expenses >= 0),
  prior_owner_income  numeric(18,2) NOT NULL DEFAULT 0
                        CHECK (prior_owner_income >= 0),
  notes               text,
  created_by          uuid REFERENCES public.employees(id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (project_id)
);

-- 1b. vendor_prior_claims
--     One row per project+vendor. Acts as "Claim #0" baseline for v_claim_totals.
CREATE TABLE public.vendor_prior_claims (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  vendor_id               uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  cutoff_date             date NOT NULL,
  prior_certified_amount  numeric(18,2) NOT NULL DEFAULT 0
                            CHECK (prior_certified_amount >= 0),
  prior_paid_amount       numeric(18,2) NOT NULL DEFAULT 0
                            CHECK (prior_paid_amount >= 0),
  prior_retention_held    numeric(18,2) NOT NULL DEFAULT 0
                            CHECK (prior_retention_held >= 0),
  -- outstanding = certified - paid - retention (computed in view, not stored)
  notes                   text,
  created_by              uuid REFERENCES public.employees(id),
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  UNIQUE (project_id, vendor_id),
  CONSTRAINT chk_vpc_paid_within_certified
    CHECK (prior_paid_amount + prior_retention_held <= prior_certified_amount)
);

-- 1c. opening_stock_entries
--     One row per project+warehouse+item. Seeds physical inventory at go-live.
CREATE TABLE public.opening_stock_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  warehouse_id  uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  qty           numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_price    numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  cutoff_date   date NOT NULL,
  notes         text,
  created_by    uuid REFERENCES public.employees(id),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (project_id, warehouse_id, item_id)
);

-- ============================================================================
-- 2. EXTEND stock_movements movement_type
-- ============================================================================

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
    CHECK (movement_type IN (
      'in_invoice', 'transfer_out', 'transfer_in', 'issue', 'adjust', 'opening_balance'
    ));

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX idx_project_opening_balances_project ON public.project_opening_balances(project_id);
CREATE INDEX idx_vendor_prior_claims_project      ON public.vendor_prior_claims(project_id);
CREATE INDEX idx_vendor_prior_claims_vendor       ON public.vendor_prior_claims(vendor_id);
CREATE INDEX idx_opening_stock_entries_project    ON public.opening_stock_entries(project_id);
CREATE INDEX idx_opening_stock_entries_wh_item    ON public.opening_stock_entries(warehouse_id, item_id);

-- ============================================================================
-- 4. UPDATED TRIGGERS
-- ============================================================================

CREATE TRIGGER trg_set_updated_at_proj_opening
  BEFORE UPDATE ON public.project_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_set_updated_at_vendor_prior
  BEFORE UPDATE ON public.vendor_prior_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS
-- ============================================================================

ALTER TABLE public.project_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_prior_claims       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_stock_entries     ENABLE ROW LEVEL SECURITY;

-- project_opening_balances
CREATE POLICY "Opening balance select scoped" ON public.project_opening_balances
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Opening balance write super admin only" ON public.project_opening_balances
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- vendor_prior_claims
CREATE POLICY "Vendor prior claims select scoped" ON public.vendor_prior_claims
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Vendor prior claims write super admin only" ON public.vendor_prior_claims
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- opening_stock_entries
CREATE POLICY "Opening stock select scoped" ON public.opening_stock_entries
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.has_project_access(project_id));

CREATE POLICY "Opening stock write super admin only" ON public.opening_stock_entries
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ============================================================================
-- 6. REBUILD v_claim_totals — Option B flat offset for vendor_prior_claims
-- ============================================================================

DROP VIEW IF EXISTS public.v_claim_totals CASCADE;

CREATE OR REPLACE VIEW public.v_claim_totals WITH (security_invoker = true) AS
WITH item_math AS (
  SELECT
    ci.claim_id,
    ci.item_ref,
    ci.previous_qty,
    ci.current_qty,
    ci.unit_price,
    ci.disbursement_pct,
    (ci.previous_qty + ci.current_qty) * ci.unit_price                              AS cumulative_line_total,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * ci.disbursement_pct        AS cumulative_payable,
    (ci.previous_qty + ci.current_qty) * ci.unit_price * (1 - ci.disbursement_pct)  AS cumulative_retained
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
-- Prior cumulative payable from previous IN-SYSTEM approved claims
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
  c.id          AS claim_id,
  c.claim_type,
  c.party_id,
  c.project_id,
  c.claim_number,
  cs.claim_cumulative_total,
  cs.claim_cumulative_payable,
  cs.claim_cumulative_retained,
  -- ► Option B: prior_cumulative_payable = in-system prior + flat Claim #0 offset
  isp.in_system_prior_payable
    + COALESCE(vpc.prior_certified_amount, 0)                                        AS prior_cumulative_payable,
  -- net_payable_before_tax = cumulative_payable − total prior
  (cs.claim_cumulative_payable
    - isp.in_system_prior_payable
    - COALESCE(vpc.prior_certified_amount, 0))                                       AS net_payable_before_tax,
  -- tax
  CASE WHEN c.tax_enabled THEN
    (cs.claim_cumulative_payable
      - isp.in_system_prior_payable
      - COALESCE(vpc.prior_certified_amount, 0)) * c.tax_rate
  ELSE 0 END                                                                         AS tax_amount,
  -- total_due_this_claim (with tax)
  (cs.claim_cumulative_payable
    - isp.in_system_prior_payable
    - COALESCE(vpc.prior_certified_amount, 0))
  + CASE WHEN c.tax_enabled THEN
      (cs.claim_cumulative_payable
        - isp.in_system_prior_payable
        - COALESCE(vpc.prior_certified_amount, 0)) * c.tax_rate
    ELSE 0 END                                                                       AS total_due_this_claim
FROM public.claims c
LEFT JOIN claim_sums cs       ON cs.claim_id    = c.id
LEFT JOIN in_system_prior isp ON isp.claim_id   = c.id
-- Only join vendor_prior_claims for vendor claim type (not owner)
LEFT JOIN public.vendor_prior_claims vpc
       ON vpc.project_id = c.project_id
      AND vpc.vendor_id  = c.party_id
      AND c.claim_type   = 'vendor';

-- ============================================================================
-- 7. REBUILD v_project_financial_position — include opening balance figures
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
-- avg_cost per item per project = total value in / total qty in for all +ve movements
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
    COALESCE(ob.prior_owner_income, 0)
      + COALESCE(pca.owner_billed, 0)                      AS total_income,

    COALESCE(ob.prior_expenses, 0)
      + COALESCE(pca.vendor_billed, 0)
      + COALESCE(ia.invoice_total, 0)
      + COALESCE(ea.total_employee_expenses, 0)            AS total_expenses,

    -- balance = total_income − total_expenses
    -- (inventory_asset_value is shown separately as an asset, not deducted here)
    COALESCE(ob.prior_owner_income, 0)
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
-- 8. RPCs
-- ============================================================================

-- 8a. upsert_project_opening_balance
CREATE OR REPLACE FUNCTION public.upsert_project_opening_balance(
    p_project_id         uuid,
    p_cutoff_date        date,
    p_prior_expenses     numeric,
    p_prior_owner_income numeric,
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

    IF p_prior_expenses < 0 OR p_prior_owner_income < 0 THEN
        RAISE EXCEPTION 'Opening balance amounts cannot be negative';
    END IF;

    v_emp_id := public.current_employee_id();

    INSERT INTO public.project_opening_balances
        (project_id, cutoff_date, prior_expenses, prior_owner_income, notes, created_by)
    VALUES
        (p_project_id, p_cutoff_date, p_prior_expenses, p_prior_owner_income, p_notes, v_emp_id)
    ON CONFLICT (project_id) DO UPDATE SET
        cutoff_date        = EXCLUDED.cutoff_date,
        prior_expenses     = EXCLUDED.prior_expenses,
        prior_owner_income = EXCLUDED.prior_owner_income,
        notes              = EXCLUDED.notes,
        updated_at         = now()
    RETURNING id INTO v_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'project_opening_balance', p_project_id,
            jsonb_build_object(
                'cutoff_date', p_cutoff_date,
                'prior_expenses', p_prior_expenses,
                'prior_owner_income', p_prior_owner_income
            ));

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8b. upsert_vendor_prior_claim
CREATE OR REPLACE FUNCTION public.upsert_vendor_prior_claim(
    p_project_id             uuid,
    p_vendor_id              uuid,
    p_cutoff_date            date,
    p_prior_certified_amount numeric,
    p_prior_paid_amount      numeric,
    p_prior_retention_held   numeric,
    p_notes                  text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_emp_id uuid;
    v_id     uuid;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can set vendor prior claims';
    END IF;

    IF p_prior_certified_amount < 0 OR p_prior_paid_amount < 0 OR p_prior_retention_held < 0 THEN
        RAISE EXCEPTION 'Prior claim amounts cannot be negative';
    END IF;

    IF p_prior_paid_amount + p_prior_retention_held > p_prior_certified_amount THEN
        RAISE EXCEPTION 'Paid + Retention cannot exceed Certified amount';
    END IF;

    v_emp_id := public.current_employee_id();

    INSERT INTO public.vendor_prior_claims
        (project_id, vendor_id, cutoff_date, prior_certified_amount,
         prior_paid_amount, prior_retention_held, notes, created_by)
    VALUES
        (p_project_id, p_vendor_id, p_cutoff_date, p_prior_certified_amount,
         p_prior_paid_amount, p_prior_retention_held, p_notes, v_emp_id)
    ON CONFLICT (project_id, vendor_id) DO UPDATE SET
        cutoff_date             = EXCLUDED.cutoff_date,
        prior_certified_amount  = EXCLUDED.prior_certified_amount,
        prior_paid_amount       = EXCLUDED.prior_paid_amount,
        prior_retention_held    = EXCLUDED.prior_retention_held,
        notes                   = EXCLUDED.notes,
        updated_at              = now()
    RETURNING id INTO v_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'vendor_prior_claim', p_project_id,
            jsonb_build_object(
                'vendor_id', p_vendor_id,
                'prior_certified_amount', p_prior_certified_amount,
                'prior_paid_amount', p_prior_paid_amount,
                'prior_retention_held', p_prior_retention_held
            ));

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8c. delete_vendor_prior_claim
CREATE OR REPLACE FUNCTION public.delete_vendor_prior_claim(
    p_id uuid
) RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_row    public.vendor_prior_claims;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can delete vendor prior claims';
    END IF;

    SELECT * INTO v_row FROM public.vendor_prior_claims WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Vendor prior claim not found';
    END IF;

    v_emp_id := public.current_employee_id();

    DELETE FROM public.vendor_prior_claims WHERE id = p_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before)
    VALUES (v_emp_id, 'delete', 'vendor_prior_claim', p_id,
            to_jsonb(v_row));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8d. upsert_opening_stock_entry
--     Creates/updates the opening_stock_entries row AND its stock_movements row.
CREATE OR REPLACE FUNCTION public.upsert_opening_stock_entry(
    p_project_id   uuid,
    p_warehouse_id uuid,
    p_item_id      uuid,
    p_qty          numeric,
    p_unit_price   numeric,
    p_cutoff_date  date,
    p_notes        text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_emp_id      uuid;
    v_entry_id    uuid;
    v_old_mov_id  uuid;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can set opening stock entries';
    END IF;

    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'Opening stock quantity must be positive';
    END IF;
    IF p_unit_price < 0 THEN
        RAISE EXCEPTION 'Unit price cannot be negative';
    END IF;

    v_emp_id := public.current_employee_id();

    -- Find the old stock movement reference (if entry exists)
    SELECT sm.id INTO v_old_mov_id
    FROM public.opening_stock_entries ose
    JOIN public.stock_movements sm
      ON sm.warehouse_id   = ose.warehouse_id
     AND sm.item_id        = ose.item_id
     AND sm.movement_type  = 'opening_balance'
     AND sm.reference_id   = ose.id
    WHERE ose.project_id   = p_project_id
      AND ose.warehouse_id = p_warehouse_id
      AND ose.item_id      = p_item_id
    LIMIT 1;

    -- Upsert the opening stock entry
    INSERT INTO public.opening_stock_entries
        (project_id, warehouse_id, item_id, qty, unit_price, cutoff_date, notes, created_by)
    VALUES
        (p_project_id, p_warehouse_id, p_item_id, p_qty, p_unit_price, p_cutoff_date, p_notes, v_emp_id)
    ON CONFLICT (project_id, warehouse_id, item_id) DO UPDATE SET
        qty          = EXCLUDED.qty,
        unit_price   = EXCLUDED.unit_price,
        cutoff_date  = EXCLUDED.cutoff_date,
        notes        = EXCLUDED.notes
    RETURNING id INTO v_entry_id;

    -- Remove old stock movement if exists
    IF v_old_mov_id IS NOT NULL THEN
        DELETE FROM public.stock_movements WHERE id = v_old_mov_id;
    END IF;

    -- Insert fresh stock movement
    INSERT INTO public.stock_movements
        (warehouse_id, item_id, movement_type, qty, unit_price, reference_id, notes, created_by)
    VALUES
        (p_warehouse_id, p_item_id, 'opening_balance', p_qty, p_unit_price,
         v_entry_id, COALESCE(p_notes, 'Opening balance stock entry'), v_emp_id);

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
    VALUES (v_emp_id, 'create', 'opening_stock_entry', v_entry_id,
            jsonb_build_object(
                'warehouse_id', p_warehouse_id,
                'item_id', p_item_id,
                'qty', p_qty,
                'unit_price', p_unit_price
            ));

    RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8e. delete_opening_stock_entry
CREATE OR REPLACE FUNCTION public.delete_opening_stock_entry(
    p_entry_id uuid
) RETURNS void AS $$
DECLARE
    v_emp_id uuid;
    v_entry  public.opening_stock_entries;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Only super-admins can delete opening stock entries';
    END IF;

    SELECT * INTO v_entry FROM public.opening_stock_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Opening stock entry not found';
    END IF;

    v_emp_id := public.current_employee_id();

    -- Delete corresponding stock movement
    DELETE FROM public.stock_movements
    WHERE movement_type = 'opening_balance'
      AND reference_id  = p_entry_id;

    DELETE FROM public.opening_stock_entries WHERE id = p_entry_id;

    INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before)
    VALUES (v_emp_id, 'delete', 'opening_stock_entry', p_entry_id, to_jsonb(v_entry));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

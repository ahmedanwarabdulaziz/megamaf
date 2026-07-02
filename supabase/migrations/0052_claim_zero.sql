-- 0052_claim_zero.sql
-- Enables Claim #0 to be a real claim record with items, skipping warehouse/bank deductions.

-- 1. Add opening_paid_amount to claims
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS opening_paid_amount numeric(18,2) NOT NULL DEFAULT 0
    CHECK (opening_paid_amount >= 0);

-- 2. Update approve_claim to skip warehouse deductions for claim_number = 0
CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id uuid)
RETURNS void AS $$
DECLARE
  v_status     text;
  v_emp_id     uuid;
  v_project_id uuid;
  v_item       record;
  v_bundle     record;
  v_on_hand    numeric;
  v_deduct_qty numeric;
BEGIN
  v_emp_id := public.current_employee_id();

  SELECT status, project_id
  INTO   v_status, v_project_id
  FROM   public.claims
  WHERE  id = p_claim_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  IF NOT (SELECT can_approve FROM public.employees WHERE id = v_emp_id)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized to approve claims';
  END IF;

  IF NOT public.has_project_access(v_project_id)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized on this project';
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.claims
  SET    status = 'approved', approved_by = v_emp_id, approved_at = now()
  WHERE  id = p_claim_id;

  INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, after)
  VALUES (v_emp_id, 'approve', 'claim', p_claim_id,
          jsonb_build_object('status', 'approved'));

  -- ── Skip ALL warehouse deductions for Claim #0 (opening balance — historical) ──
  IF (SELECT claim_number FROM public.claims WHERE id = p_claim_id) = 0 THEN
    RETURN;
  END IF;

  -- ── New bundle-based deductions ──────────────────────────────────────
  FOR v_item IN
    SELECT ci.id AS claim_item_id, ci.current_qty
    FROM   public.claim_items ci
    WHERE  ci.claim_id = p_claim_id
      AND  ci.is_stock_issue = true
  LOOP
    FOR v_bundle IN
      SELECT b.warehouse_id, b.item_id, b.qty_per_unit
      FROM   public.claim_item_stock_bundles b
      WHERE  b.claim_item_id = v_item.claim_item_id
    LOOP
      v_deduct_qty := v_bundle.qty_per_unit * v_item.current_qty;

      SELECT COALESCE(
        (SELECT qty_on_hand
         FROM   public.v_stock_on_hand
         WHERE  warehouse_id = v_bundle.warehouse_id
           AND  item_id      = v_bundle.item_id),
        0
      ) INTO v_on_hand;

      IF v_on_hand < v_deduct_qty THEN
        RAISE EXCEPTION
          'Insufficient stock for item % in warehouse %. Have %, need %',
          v_bundle.item_id, v_bundle.warehouse_id, v_on_hand, v_deduct_qty;
      END IF;

      INSERT INTO public.stock_movements (
        warehouse_id, item_id, movement_type, qty,
        reference_id, notes, created_by
      ) VALUES (
        v_bundle.warehouse_id, v_bundle.item_id,
        'issue', -v_deduct_qty,
        p_claim_id, 'Claim bundle issue', v_emp_id
      );
    END LOOP;

    -- ── Legacy fallback: single item_id on claim_items (no bundle rows) ──
    IF NOT EXISTS (
      SELECT 1 FROM public.claim_item_stock_bundles
      WHERE claim_item_id = v_item.claim_item_id
    ) THEN
      FOR v_bundle IN
        SELECT warehouse_id, item_id, current_qty AS qty_per_unit
        FROM   public.claim_items
        WHERE  id             = v_item.claim_item_id
          AND  warehouse_id   IS NOT NULL
          AND  item_id        IS NOT NULL
      LOOP
        SELECT COALESCE(
          (SELECT qty_on_hand
           FROM   public.v_stock_on_hand
           WHERE  warehouse_id = v_bundle.warehouse_id
             AND  item_id      = v_bundle.item_id),
          0
        ) INTO v_on_hand;

        IF v_on_hand < v_bundle.qty_per_unit THEN
          RAISE EXCEPTION
            'Insufficient stock for item % in warehouse % (legacy). Have %, need %',
            v_bundle.item_id, v_bundle.warehouse_id,
            v_on_hand, v_bundle.qty_per_unit;
        END IF;

        INSERT INTO public.stock_movements (
          warehouse_id, item_id, movement_type, qty,
          reference_id, notes, created_by
        ) VALUES (
          v_bundle.warehouse_id, v_bundle.item_id,
          'issue', -v_bundle.qty_per_unit,
          p_claim_id, 'Owner claim issue (legacy)', v_emp_id
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Update v_vendor_account
DROP VIEW IF EXISTS public.v_vendor_account CASCADE;
CREATE OR REPLACE VIEW public.v_vendor_account WITH (security_invoker = true) AS
WITH vendor_docs AS (
    -- ► Claim #0 — Pre-system opening balance (vendor_prior_claims fallback)
    SELECT
        vpc.vendor_id                                                               AS party_id,
        vpc.project_id,
        vpc.cutoff_date                                                             AS document_date,
        'prior_claim'                                                               AS document_type,
        vpc.id                                                                      AS document_id,
        'مستخلص #0 (رصيد افتتاحي قبل النظام)'                                      AS description,
        vpc.prior_certified_amount                                                  AS amount_due,
        vpc.prior_paid_amount                                                       AS amount_paid,
        vpc.created_at
    FROM public.vendor_prior_claims vpc
    WHERE NOT EXISTS (
        SELECT 1 FROM public.claims c
        WHERE c.party_id = vpc.vendor_id
          AND c.project_id = vpc.project_id
          AND c.claim_type = 'vendor'
          AND c.claim_number = 0
          AND c.status = 'approved'
    )

    UNION ALL

    -- ► Approved invoices
    SELECT
        i.vendor_id                                                                 AS party_id,
        i.project_id,
        i.invoice_date                                                              AS document_date,
        'invoice'                                                                   AS document_type,
        i.id                                                                        AS document_id,
        ('فاتورة #' || i.id::text)                                                  AS description,
        i.total                                                                     AS amount_due,
        COALESCE(
            (SELECT vip.paid_amount
               FROM public.v_invoice_paid vip
              WHERE vip.invoice_id = i.id),
            0
        )                                                                           AS amount_paid,
        i.created_at
    FROM public.invoices i
    WHERE i.status = 'approved'

    UNION ALL

    -- ► Approved vendor claims (in-system)
    SELECT
        c.party_id,
        c.project_id,
        c.claim_date                                                                AS document_date,
        CASE WHEN c.claim_number = 0 THEN 'prior_claim' ELSE 'claim' END            AS document_type,
        c.id                                                                        AS document_id,
        CASE WHEN c.claim_number = 0
             THEN 'مستخلص #0 (رصيد افتتاحي قبل النظام)'
             ELSE ('مستخلص مقاول رقم ' || c.claim_number::text)
        END                                                                         AS description,
        COALESCE(
            (SELECT vct.total_due_this_claim
               FROM public.v_claim_totals vct
              WHERE vct.claim_id = c.id),
            0
        )                                                                           AS amount_due,
        CASE WHEN c.claim_number = 0 THEN c.opening_paid_amount ELSE 0::numeric END AS amount_paid,
        c.created_at
    FROM public.claims c
    WHERE c.status = 'approved'
      AND c.claim_type = 'vendor'

    UNION ALL

    -- ► Retention releases
    SELECT
        r.party_id,
        r.project_id,
        r.released_at::date                                                         AS document_date,
        'retention_release'                                                         AS document_type,
        r.id                                                                        AS document_id,
        'إفراج ضمان حسن تنفيذ'                                                      AS description,
        r.amount                                                                    AS amount_due,
        COALESCE(
            (SELECT vrp.paid_amount
               FROM public.v_retention_paid vrp
              WHERE vrp.retention_id = r.id),
            0
        )                                                                           AS amount_paid,
        r.created_at
    FROM public.retention_releases r
    WHERE r.claim_type = 'vendor'

    UNION ALL

    -- ► Outgoing ledger payments to vendors
    SELECT
        le.counterparty_id                                                          AS party_id,
        le.project_id,
        le.entry_date                                                               AS document_date,
        'payment'                                                                   AS document_type,
        le.id                                                                       AS document_id,
        COALESCE(le.memo, 'دفعة للمقاول')                                           AS description,
        0::numeric                                                                  AS amount_due,
        le.amount                                                                   AS amount_paid,
        le.created_at
    FROM public.ledger_entries le
    WHERE le.counterparty_type = 'vendor'
      AND le.direction          = 'out'
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
FROM vendor_docs d
LEFT JOIN public.projects p ON p.id = d.project_id;


-- 4. Update v_owner_account
DROP VIEW IF EXISTS public.v_owner_account CASCADE;
CREATE OR REPLACE VIEW public.v_owner_account WITH (security_invoker = true) AS
WITH owner_docs AS (
    -- 1. Approved owner claims (what the owner owes us — in-system)
    SELECT
        c.party_id,
        c.project_id,
        c.claim_date                                                                AS document_date,
        CASE WHEN c.claim_number = 0 THEN 'opening_balance' ELSE 'claim' END        AS document_type,
        c.id                                                                        AS document_id,
        CASE WHEN c.claim_number = 0
             THEN 'رصيد افتتاحي للمشروع (مستخلص #0)'
             ELSE ('مستخلص مالك رقم ' || c.claim_number::text)
        END                                                                         AS description,
        COALESCE(
            (SELECT vct.total_due_this_claim
               FROM public.v_claim_totals vct
              WHERE vct.claim_id = c.id),
            0
        )                                                                           AS amount_due,
        CASE WHEN c.claim_number = 0 THEN c.opening_paid_amount ELSE 0::numeric END AS amount_paid,
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

    -- 3. Project Opening Balances — Owner Claim #0 (fallback)
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
      AND NOT EXISTS (
        SELECT 1 FROM public.claims c
        WHERE c.party_id = p.owner_id
          AND c.project_id = ob.project_id
          AND c.claim_type = 'owner'
          AND c.claim_number = 0
          AND c.status = 'approved'
      )
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


DROP VIEW IF EXISTS public.v_owner_balances CASCADE;
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


-- 5. Update v_vendor_balances
DROP VIEW IF EXISTS public.v_vendor_balances CASCADE;
CREATE OR REPLACE VIEW public.v_vendor_balances WITH (security_invoker = true) AS
WITH
latest_claims AS (
    SELECT DISTINCT ON (c.party_id, c.project_id)
        c.id          AS claim_id,
        c.party_id    AS vendor_id,
        c.project_id,
        c.tax_enabled,
        c.tax_rate
    FROM public.claims c
    WHERE c.claim_type = 'vendor'
      AND c.status = 'approved'
    ORDER BY c.party_id, c.project_id, c.claim_number DESC
),
claim_totals AS (
    SELECT
        lc.vendor_id,
        lc.project_id,
        COALESCE(vct.claim_cumulative_total,    0) AS gross_in_system,
        COALESCE(vct.claim_cumulative_retained, 0) AS retained_in_system
    FROM latest_claims lc
    JOIN public.v_claim_totals vct ON vct.claim_id = lc.claim_id
),
claim_paid AS (
    SELECT
        c.party_id                          AS vendor_id,
        c.project_id,
        COALESCE(SUM(vcp.paid_amount), 0)   AS paid_in_system
    FROM public.claims c
    JOIN public.v_claim_paid vcp ON vcp.claim_id = c.id
    WHERE c.claim_type = 'vendor'
      AND c.status     = 'approved'
    GROUP BY c.party_id, c.project_id
),
prior AS (
    SELECT
        vendor_id,
        project_id,
        COALESCE(prior_certified_amount, 0) AS prior_certified,
        COALESCE(prior_paid_amount,      0) AS prior_paid,
        COALESCE(prior_retention_held,   0) AS prior_retention
    FROM public.vendor_prior_claims
),
vendor_agg AS (
    SELECT
        ct.vendor_id,
        SUM(ct.gross_in_system     + COALESCE(p.prior_certified, 0))                    AS gross_total,
        SUM(ct.retained_in_system  + COALESCE(p.prior_retention, 0))                    AS total_retention_held,
        SUM((ct.gross_in_system    + COALESCE(p.prior_certified, 0))
          - (ct.retained_in_system + COALESCE(p.prior_retention, 0)))                   AS total_due,
        SUM(COALESCE(cp.paid_in_system, 0) + COALESCE(p.prior_paid, 0))                AS total_paid
    FROM claim_totals ct
    LEFT JOIN prior p  ON p.vendor_id  = ct.vendor_id  AND p.project_id  = ct.project_id
        AND NOT EXISTS (
            SELECT 1 FROM public.claims c0
            WHERE c0.party_id = ct.vendor_id
              AND c0.project_id = ct.project_id
              AND c0.claim_type = 'vendor'
              AND c0.claim_number = 0
              AND c0.status = 'approved'
        )
    LEFT JOIN claim_paid cp ON cp.vendor_id = ct.vendor_id  AND cp.project_id = ct.project_id
    GROUP BY ct.vendor_id
),
prior_only AS (
    SELECT
        p.vendor_id,
        SUM(p.prior_certified)                      AS gross_total,
        SUM(p.prior_retention)                      AS total_retention_held,
        SUM(p.prior_certified - p.prior_retention)  AS total_due,
        SUM(p.prior_paid)                           AS total_paid
    FROM prior p
    WHERE NOT EXISTS (
        SELECT 1 FROM claim_totals ct
        WHERE ct.vendor_id = p.vendor_id AND ct.project_id = p.project_id
    )
    AND NOT EXISTS (
        SELECT 1 FROM public.claims c
        WHERE c.party_id = p.vendor_id
          AND c.project_id = p.project_id
          AND c.claim_type = 'vendor'
          AND c.claim_number = 0
          AND c.status = 'approved'
    )
    GROUP BY p.vendor_id
),
all_agg AS (
    SELECT * FROM vendor_agg
    UNION ALL
    SELECT * FROM prior_only
),
combined AS (
    SELECT
        vendor_id,
        SUM(gross_total)          AS gross_total,
        SUM(total_retention_held) AS total_retention_held,
        SUM(total_due)            AS total_due,
        SUM(total_paid)           AS total_paid,
        SUM(total_due) - SUM(total_paid) AS balance
    FROM all_agg
    GROUP BY vendor_id
)
SELECT
    v.id                                  AS vendor_id,
    v.name                                AS vendor_name,
    COALESCE(c.gross_total,          0)   AS gross_total,
    COALESCE(c.total_retention_held, 0)   AS total_retention_held,
    COALESCE(c.total_due,            0)   AS total_due,
    COALESCE(c.total_paid,           0)   AS total_paid,
    COALESCE(c.balance,              0)   AS balance
FROM public.vendors v
LEFT JOIN combined c ON c.vendor_id = v.id
WHERE COALESCE(c.balance,     0) > 0
   OR COALESCE(c.gross_total, 0) > 0;

-- 6. Update v_project_financial_position
DROP VIEW IF EXISTS public.v_project_financial_position CASCADE;
CREATE OR REPLACE VIEW public.v_project_financial_position WITH (security_invoker = true) AS
WITH
latest_vendor_claims AS (
    SELECT DISTINCT ON (c.party_id, c.project_id)
        c.project_id,
        vct.claim_cumulative_total    AS gross_in_system,
        vct.claim_cumulative_retained AS retained_in_system,
        vct.total_due_this_claim
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status     = 'approved'
      AND c.claim_type = 'vendor'
    ORDER BY c.party_id, c.project_id, c.claim_number DESC
),
owner_claims AS (
    SELECT
        c.project_id,
        vct.total_due_this_claim
    FROM public.claims c
    JOIN public.v_claim_totals vct ON vct.claim_id = c.id
    WHERE c.status     = 'approved'
      AND c.claim_type = 'owner'
),
proj_claims_agg AS (
    SELECT
        project_id,
        SUM(gross_in_system)    AS vendor_billed,
        SUM(retained_in_system) AS vendor_retained
    FROM latest_vendor_claims
    GROUP BY project_id
),
owner_claims_agg AS (
    SELECT
        project_id,
        SUM(total_due_this_claim) AS owner_billed
    FROM owner_claims
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
vendor_claim_payments AS (
    SELECT
        c.project_id,
        COALESCE(SUM(vcp.paid_amount), 0) AS paid_in_system
    FROM public.claims c
    JOIN public.v_claim_paid vcp ON vcp.claim_id = c.id
    WHERE c.claim_type = 'vendor'
      AND c.status     = 'approved'
    GROUP BY c.project_id
),
owner_claim_payments AS (
    SELECT
        c.project_id,
        COALESCE(SUM(vcp.paid_amount), 0) AS paid_in_system
    FROM public.claims c
    JOIN public.v_claim_paid vcp ON vcp.claim_id = c.id
    WHERE c.claim_type = 'owner'
      AND c.status     = 'approved'
    GROUP BY c.project_id
),
invoice_payments AS (
    SELECT
        i.project_id,
        COALESCE(SUM(vip.paid_amount), 0) AS paid
    FROM public.invoices i
    JOIN public.v_invoice_paid vip ON vip.invoice_id = i.id
    WHERE i.status = 'approved'
    GROUP BY i.project_id
),
retention_releases_agg AS (
    SELECT project_id, SUM(amount) AS retention_released
    FROM public.retention_releases
    WHERE claim_type = 'vendor'
    GROUP BY project_id
),
retention_release_payments AS (
    SELECT
        r.project_id,
        COALESCE(SUM(vrp.paid_amount), 0) AS paid
    FROM public.retention_releases r
    JOIN public.v_retention_paid vrp ON vrp.retention_id = r.id
    WHERE r.claim_type = 'vendor'
    GROUP BY r.project_id
),
prior_vendor_claims_agg AS (
    SELECT
        vpc.project_id,
        SUM(vpc.prior_certified_amount) AS total_prior_certified,
        SUM(vpc.prior_paid_amount)      AS total_prior_paid,
        SUM(vpc.prior_retention_held)   AS total_prior_retention,
        COUNT(*)                    AS vendor_count
    FROM public.vendor_prior_claims vpc
    WHERE NOT EXISTS (
        SELECT 1 FROM public.claims c0
        WHERE c0.project_id = vpc.project_id
          AND c0.party_id = vpc.vendor_id
          AND c0.claim_type = 'vendor'
          AND c0.claim_number = 0
          AND c0.status = 'approved'
    )
    GROUP BY vpc.project_id
),
inventory_receipts AS (
    SELECT
        w.project_id,
        sm.item_id,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END)                                    AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END)       AS total_value_in
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
),
inventory_value AS (
    SELECT
        h.project_id,
        SUM(h.qty_on_hand * c.avg_cost) AS total_value
    FROM inventory_on_hand h
    JOIN inventory_avg_cost c ON c.project_id = h.project_id AND c.item_id = h.item_id
    WHERE h.qty_on_hand > 0
    GROUP BY h.project_id
),
project_opening AS (
    SELECT
        ob.project_id,
        ob.cutoff_date,
        ob.prior_expenses,
        ob.prior_owner_income,
        ob.prior_owner_dues
    FROM public.project_opening_balances ob
    WHERE NOT EXISTS (
        SELECT 1 FROM public.claims c
        JOIN public.projects p ON p.id = ob.project_id
        WHERE c.party_id = p.owner_id
          AND c.project_id = ob.project_id
          AND c.claim_type = 'owner'
          AND c.claim_number = 0
          AND c.status = 'approved'
    )
)
SELECT
    p.id AS project_id,
    (
        COALESCE(oa.owner_billed, 0) +
        COALESCE(po.prior_owner_dues, 0)
    ) AS total_income,
    
    (
        COALESCE(ca.vendor_billed, 0) +
        COALESCE(ia.invoice_total, 0) +
        COALESCE(ea.total_employee_expenses, 0) +
        COALESCE(pva.total_prior_certified, 0)
    ) AS total_expenses,
    
    (
        (COALESCE(oa.owner_billed, 0) + COALESCE(po.prior_owner_dues, 0)) -
        (COALESCE(ca.vendor_billed, 0) + COALESCE(ia.invoice_total, 0) + COALESCE(ea.total_employee_expenses, 0) + COALESCE(pva.total_prior_certified, 0))
    ) AS balance,
    
    (
        COALESCE(ca.vendor_retained, 0) +
        COALESCE(pva.total_prior_retention, 0) -
        COALESCE(rra.retention_released, 0)
    ) AS current_retention_held,
    
    COALESCE(iv.total_value, 0) AS inventory_asset_value,
    
    CASE WHEN po.project_id IS NOT NULL THEN true ELSE false END AS has_opening_balance,
    po.cutoff_date AS opening_cutoff_date,
    COALESCE(po.prior_expenses, 0) AS prior_expenses,
    COALESCE(po.prior_owner_income, 0) AS prior_owner_income,
    COALESCE(po.prior_owner_dues, 0) AS prior_owner_dues,
    
    (
        COALESCE(op.paid_in_system, 0) +
        COALESCE(po.prior_owner_income, 0)
    ) AS owner_total_collected,
    
    (
        COALESCE(vp.paid_in_system, 0) +
        COALESCE(ip.paid, 0) +
        COALESCE(rp.paid, 0) +
        COALESCE(pva.total_prior_paid, 0)
    ) AS total_cash_paid
    
FROM public.projects p
LEFT JOIN proj_claims_agg ca ON ca.project_id = p.id
LEFT JOIN owner_claims_agg oa ON oa.project_id = p.id
LEFT JOIN invoices_agg ia ON ia.project_id = p.id
LEFT JOIN expenses_agg ea ON ea.project_id = p.id
LEFT JOIN retention_releases_agg rra ON rra.project_id = p.id
LEFT JOIN vendor_claim_payments vp ON vp.project_id = p.id
LEFT JOIN owner_claim_payments op ON op.project_id = p.id
LEFT JOIN invoice_payments ip ON ip.project_id = p.id
LEFT JOIN retention_release_payments rp ON rp.project_id = p.id
LEFT JOIN prior_vendor_claims_agg pva ON pva.project_id = p.id
LEFT JOIN inventory_value iv ON iv.project_id = p.id
LEFT JOIN project_opening po ON po.project_id = p.id;

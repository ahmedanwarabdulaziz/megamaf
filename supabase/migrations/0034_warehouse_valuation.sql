-- 0034_warehouse_valuation.sql

-- Drop view if it exists
DROP VIEW IF EXISTS public.v_warehouse_valuation CASCADE;

-- Create the view
CREATE OR REPLACE VIEW public.v_warehouse_valuation WITH (security_invoker = true) AS
WITH inventory_receipts AS (
    SELECT
        sm.item_id,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty ELSE 0 END) AS total_qty_in,
        SUM(CASE WHEN sm.qty > 0 THEN sm.qty * COALESCE(sm.unit_price, 0) ELSE 0 END) AS total_value_in
    FROM public.stock_movements sm
    GROUP BY sm.item_id
),
item_avg_cost AS (
    SELECT
        item_id,
        CASE WHEN total_qty_in > 0
             THEN total_value_in / total_qty_in
             ELSE 0
        END AS avg_cost
    FROM inventory_receipts
)
SELECT 
    v.warehouse_id,
    SUM(v.qty_on_hand * COALESCE(c.avg_cost, 0)) as total_value
FROM public.v_stock_on_hand v
LEFT JOIN item_avg_cost c ON c.item_id = v.item_id
GROUP BY v.warehouse_id;

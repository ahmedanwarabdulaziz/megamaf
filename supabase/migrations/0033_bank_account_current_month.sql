-- 0033_bank_account_current_month.sql

DROP VIEW IF EXISTS public.v_bank_account_balances CASCADE;

CREATE OR REPLACE VIEW v_bank_account_balances WITH (security_invoker = true) AS
SELECT 
    ba.id AS bank_account_id,
    ba.bank_id,
    b.name AS bank_name,
    ba.account_name,
    ba.account_number,
    ba.currency,
    ba.opening_balance AS initial_balance,
    COALESCE(SUM(
        CASE 
            WHEN le.direction = 'in' THEN le.amount 
            WHEN le.direction = 'out' THEN -le.amount 
            ELSE 0 
        END
    ), 0) AS current_balance,
    COALESCE(SUM(
        CASE 
            WHEN le.direction = 'in' AND date_trunc('month', le.entry_date) = date_trunc('month', CURRENT_DATE) THEN le.amount 
            ELSE 0 
        END
    ), 0) AS current_month_in,
    COALESCE(SUM(
        CASE 
            WHEN le.direction = 'out' AND date_trunc('month', le.entry_date) = date_trunc('month', CURRENT_DATE) THEN le.amount 
            ELSE 0 
        END
    ), 0) AS current_month_out
FROM bank_accounts ba
JOIN banks b ON ba.bank_id = b.id
LEFT JOIN ledger_entries le ON ba.id = le.bank_account_id
GROUP BY ba.id, ba.bank_id, b.name, ba.account_name, ba.account_number, ba.currency, ba.opening_balance;

-- We also need to recreate v_bank_statement because CASCADE dropped it
CREATE OR REPLACE VIEW v_bank_statement WITH (security_invoker = true) AS
SELECT 
    le.id,
    le.bank_account_id,
    le.entry_date,
    le.created_at,
    le.direction,
    le.amount,
    le.category,
    le.memo,
    le.counterparty_type,
    le.counterparty_id,
    SUM(
        CASE 
            WHEN le.direction = 'in' THEN le.amount 
            WHEN le.direction = 'out' THEN -le.amount 
            ELSE 0 
        END
    ) OVER (
        PARTITION BY le.bank_account_id 
        ORDER BY le.entry_date ASC, le.created_at ASC
    ) AS running_balance
FROM ledger_entries le;

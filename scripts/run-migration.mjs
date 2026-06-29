/**
 * One-shot migration script: fix audit_log action constraint to include 'reject'
 * Run with: node scripts/run-migration.mjs
 */

const SUPABASE_URL = 'https://qqpumzvcthfbebaqtaqv.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxcHVtenZjdGhmYmViYXF0YXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzNjI5NSwiZXhwIjoyMDk3MDEyMjk1fQ.uqjPx7kGrdNvMdIyaCcv4vHzJLrGLG3OxazsdNRiDF4';

// SQL to fix both outstanding constraints in one go
const MIGRATIONS = [
  {
    name: '0036 - relax claim_items stock constraint (allow bundle nulls)',
    sql: `
      ALTER TABLE public.claim_items
        DROP CONSTRAINT IF EXISTS chk_claim_item_stock_issue;

      ALTER TABLE public.claim_items
        ADD CONSTRAINT chk_claim_item_stock_issue CHECK (
          (is_stock_issue = false)
          OR
          (is_stock_issue = true AND warehouse_id IS NULL AND item_id IS NULL)
          OR
          (is_stock_issue = true AND warehouse_id IS NOT NULL AND item_id IS NOT NULL)
        );
    `,
  },
  {
    name: "0037 - add 'reject' to audit_log action check",
    sql: `
      ALTER TABLE public.audit_log
        DROP CONSTRAINT IF EXISTS audit_log_action_check;

      ALTER TABLE public.audit_log
        ADD CONSTRAINT audit_log_action_check CHECK (
          action IN ('create', 'update', 'delete', 'approve', 'reject', 'login', 'logout')
        );
    `,
  },
];

async function runSQL(sql, name) {
  // Supabase exposes a pg_meta REST endpoint for SQL at /pg/query
  // We use the service_role JWT which bypasses RLS
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  return await res.json();
}

async function main() {
  console.log('🚀 Running migrations...\n');
  for (const migration of MIGRATIONS) {
    process.stdout.write(`  ▸ ${migration.name} ... `);
    try {
      await runSQL(migration.sql, migration.name);
      console.log('✅ done');
    } catch (err) {
      console.log(`❌ failed: ${err.message}`);
    }
  }
  console.log('\n✨ Done.');
}

main();

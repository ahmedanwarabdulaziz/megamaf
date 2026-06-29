/**
 * Migration 0048: Add prior_owner_dues to project_opening_balances
 *   + Update upsert_project_opening_balance RPC
 *   + Rebuild v_claim_totals (owner Claim #0 offset)
 *   + Rebuild related views
 *
 * Run with: node scripts/run-migration-048.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://qqpumzvcthfbebaqtaqv.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxcHVtenZjdGhmYmViYXF0YXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzNjI5NSwiZXhwIjoyMDk3MDEyMjk1fQ.uqjPx7kGrdNvMdIyaCcv4vHzJLrGLG3OxazsdNRiDF4';

const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0048_owner_prior_dues.sql'), 'utf8');

// Split on statement boundaries to try individual statements if bulk fails
function splitStatements(sql) {
  // Split on double newlines between semicolons for major blocks
  return sql
    .split(/;\s*\n\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => s.endsWith(';') ? s : s + ';');
}

async function runSQL(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ p_sql: query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
  return text;
}

async function main() {
  console.log('🚀 Running migration 0048: owner prior dues + v_claim_totals update...\n');

  try {
    await runSQL(sql);
    console.log('✅ Migration applied in one shot!');
  } catch (err) {
    console.log(`⚠️  Bulk run failed (${err.message.substring(0, 80)})`);
    console.log('   Trying statement-by-statement...\n');

    const statements = splitStatements(sql);
    let ok = 0, fail = 0;
    for (const stmt of statements) {
      const preview = stmt.replace(/\s+/g, ' ').substring(0, 70);
      process.stdout.write(`  ▸ ${preview}... `);
      try {
        await runSQL(stmt);
        console.log('✅');
        ok++;
      } catch (e) {
        console.log(`❌  ${e.message.substring(0, 100)}`);
        fail++;
      }
    }
    console.log(`\n  Done: ${ok} ok, ${fail} failed.`);
    if (fail > 0) {
      console.log('\n⚠️  Some statements failed. Please run the migration manually:');
      console.log('   ./supabase/migrations/0048_owner_prior_dues.sql');
    }
  }

  // Verify column exists using Supabase client
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/project_opening_balances?select=prior_owner_dues&limit=1`, {
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
      },
    });
    if (r.ok) {
      console.log('\n✅ Column prior_owner_dues is accessible in project_opening_balances!');
    } else {
      console.log('\n❌ Could not verify column. Run migration manually if needed.');
    }
  } catch (_) {}
}

main();

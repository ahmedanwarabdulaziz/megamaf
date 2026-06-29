/**
 * Migration 0049: Add per-category expense breakdown to v_project_financial_position
 * Run with: node scripts/run-migration-049.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env manually
import { config } from 'dotenv';
config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0049_financial_position_breakdown.sql'), 'utf8');

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.log('🚀 Migration 0049: adding expense breakdown columns to v_project_financial_position...\n');

  // Use the supabase rpc exec if available, otherwise print instructions
  try {
    const { error } = await sb.rpc('exec_sql', { p_sql: sql });
    if (error) throw error;
    console.log('✅ Migration applied via RPC!');
  } catch (e) {
    console.log(`⚠️  RPC exec_sql not available (${e.message?.substring(0, 60)})`);
    console.log('\n📋 Please run this SQL manually in the Supabase SQL Editor:');
    console.log('   File: supabase/migrations/0049_financial_position_breakdown.sql\n');
    console.log('   Or paste the contents of that file into:');
    console.log('   https://supabase.com/dashboard/project/qqpumzvcthfbebaqtaqv/sql\n');
  }

  // Verify the new columns are accessible
  console.log('🔍 Verifying new columns...');
  const { data, error } = await sb
    .from('v_project_financial_position')
    .select('project_id, vendor_claims_billed, invoices_billed, employee_expenses_billed, owner_paid')
    .limit(1);

  if (error) {
    console.log(`❌ New columns NOT found: ${error.message}`);
    console.log('   → Please run the SQL migration manually first.');
  } else {
    console.log('✅ New columns verified! Sample:', JSON.stringify(data?.[0] || {}));
  }
}

main();

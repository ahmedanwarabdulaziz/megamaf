/**
 * Migration 20260726130000: fold invoices into v_vendor_balances
 *
 * NOTE: the public.exec_sql RPC this script tries first no longer exists on
 * this project. It was actually applied via:
 *   npx supabase db query --linked -f supabase/migrations/20260726130000_fix_vendor_balances_invoices.sql
 * This script is kept for the verification step below and as a record of
 * the RPC-based approach other migration runner scripts in this folder use.
 *
 * Run with: node scripts/run-migration-20260726130000.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { config } from 'dotenv';
config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260726130000_fix_vendor_balances_invoices.sql'), 'utf8');

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.log('🚀 Migration 20260726130000: folding invoices into v_vendor_balances...\n');

  const { error } = await sb.rpc('exec_sql', { p_sql: sql });
  if (error) {
    console.log(`❌ RPC exec_sql failed: ${error.message}`);
    console.log('\n📋 Please run this SQL manually in the Supabase SQL Editor instead:');
    console.log('   File: supabase/migrations/20260726130000_fix_vendor_balances_invoices.sql\n');
    return;
  }
  console.log('✅ Migration applied via RPC!');

  console.log('🔍 Verifying the invoice-only vendor now appears...');
  const { data, error: verifyError } = await sb
    .from('v_vendor_balances')
    .select('*')
    .eq('vendor_id', '1bc98016-4115-4f8b-ac2b-884f2549ed80');

  if (verifyError) {
    console.log(`❌ Verification query failed: ${verifyError.message}`);
  } else {
    console.log('✅ Result:', JSON.stringify(data, null, 2));
  }
}

main();

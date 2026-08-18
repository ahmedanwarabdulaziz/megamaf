import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://qqpumzvcthfbebaqtaqv.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY must be provided through the environment.');
}

const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0040_prior_claim_payment_support.sql'), 'utf8');

async function main() {
  console.log('Applying migration 0040...\n');

  // Try the Supabase REST RPC endpoint for exec_sql (if it exists as a custom function)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ p_sql: sql }),
  });
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(text.substring(0, 500));
}

main().catch(console.error);

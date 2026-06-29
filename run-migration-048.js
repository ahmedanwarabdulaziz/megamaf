const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const sql = fs.readFileSync('./supabase/migrations/0048_owner_prior_dues.sql', 'utf8');

  // Execute via the pg RPC
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

  if (error) {
    console.error('RPC exec_sql error:', error.message);
    console.log('\nPlease run the following migration manually via the Supabase SQL editor:');
    console.log('./supabase/migrations/0048_owner_prior_dues.sql');
  } else {
    console.log('Migration 0048 applied successfully!', data);
  }

  // Verify the column exists
  const { data: check, error: checkErr } = await supabase
    .from('project_opening_balances')
    .select('id, prior_owner_dues')
    .limit(1);

  if (checkErr) {
    console.log('\n❌ Column prior_owner_dues does not exist yet.');
    console.log('Please run the SQL migration manually via Supabase SQL editor.');
  } else {
    console.log('\n✅ Column prior_owner_dues exists and is accessible!');
  }
}
run();

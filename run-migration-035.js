const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const sql = fs.readFileSync('./supabase/migrations/0035_claim_item_stock_bundles.sql', 'utf8');

  // Execute via the pg RPC
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

  if (error) {
    // Try splitting into statements and running each
    console.log('RPC exec_sql not available, trying direct REST...');
    
    // Use the Supabase Management API or pg connection
    // Fall back: just report the migration SQL is ready
    console.error('Error:', error.message);
    console.log('\nPlease run the following migration manually via the Supabase SQL editor:');
    console.log('./supabase/migrations/0035_claim_item_stock_bundles.sql');
  } else {
    console.log('Migration applied successfully!', data);
  }

  // Verify the table exists
  const { data: check, error: checkErr } = await supabase
    .from('claim_item_stock_bundles')
    .select('id')
    .limit(1);

  if (checkErr) {
    console.log('\n❌ Table claim_item_stock_bundles does not exist yet.');
    console.log('Please run the SQL migration manually.');
  } else {
    console.log('\n✅ Table claim_item_stock_bundles exists and is accessible!');
  }
}
run();

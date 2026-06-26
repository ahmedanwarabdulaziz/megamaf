const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('invoice_items').select('*').limit(1);
  console.log('Error:', error);
  console.log(JSON.stringify(data, null, 2));
}
run();

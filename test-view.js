const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('projects').select('*, v_project_financial_position(*)').eq('id', 'da1761c1-2f42-4fdc-a27a-929cb7c5a323');
  console.log('Error:', error);
  console.log(JSON.stringify(data?.[0]?.v_project_financial_position, null, 2));
}
run();

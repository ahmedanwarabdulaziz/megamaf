const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('views')
    .select('view_definition')
    .eq('table_name', 'v_bank_account_balances');
    
  if (error) {
     console.log('Error:', error);
  } else {
     console.log(data);
  }
}

main();

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*, inventory_items(name, code, unit), employees(name)')
    .limit(1);
    
  if (error) console.error("Error 1:", error);
  else console.log("Success 1:", data);
  
  const { data: d2, error: e2 } = await supabase
    .from('stock_movements')
    .select('*, inventory_items(name, code, unit), created_by:employees(name)')
    .limit(1);
    
  if (e2) console.error("Error 2:", e2);
  else console.log("Success 2:", d2);
}
run();

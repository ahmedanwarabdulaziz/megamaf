const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('get_view_definition', { view_name: 'v_stock_on_hand' });
  if (error) {
    console.log("RPC failed, trying raw query");
    // Since we don't have a direct SQL runner, I will use Postgres REST API via PostgREST if it has it, 
    // but usually we can't query pg_views directly via Supabase client unless exposed.
    // Let me try to see the raw SQL in the supabase folder (supabase/migrations).
  } else {
    console.log(data);
  }
}
run();

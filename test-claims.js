const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test1() {
  console.log("Testing claims...");
  const { data, error } = await supabase.from('claims').select(`id, claim_type, party_id, project_id, claim_number, claim_date, status, tax_enabled, tax_rate, retention_pct, notes, project:projects(name)`).limit(1);
  if (error) console.error("Error in claims:", error.message, error.details);
  else console.log("claims OK");
}

async function test2() {
  console.log("Testing v_claim_totals...");
  const { data, error } = await supabase.from('v_claim_totals').select('claim_id, claim_cumulative_total, claim_cumulative_retained, claim_cumulative_payable, prior_cumulative_payable, total_due_this_claim').limit(1);
  if (error) console.error("Error in v_claim_totals:", error.message, error.details);
  else console.log("v_claim_totals OK");
}

async function test3() {
  console.log("Testing v_claim_paid...");
  const { data, error } = await supabase.from('v_claim_paid').select('claim_id, paid_amount').limit(1);
  if (error) console.error("Error in v_claim_paid:", error.message, error.details);
  else console.log("v_claim_paid OK");
}

async function run() {
  await test1();
  await test2();
  await test3();
}
run();

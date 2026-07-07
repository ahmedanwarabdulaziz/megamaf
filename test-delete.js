const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

async function testDelete() {
  const employeeId = 'd7531769-9280-4cf5-9e01-6afb3a277757';
  
  // Find a disbursement for this employee
  const { data: entries, error } = await adminSupabase
    .from('ledger_entries')
    .select('*')
    .eq('category', 'custody_disbursement')
    .eq('employee_id', employeeId)
    .limit(1);

  if (error || !entries || entries.length === 0) {
    console.log('No entries found or error:', error);
    return;
  }

  const entry = entries[0];
  console.log('Found entry:', entry);

  const id = entry.id;

  // Try to delete bank entry
  const { data: delBank, error: err2 } = await adminSupabase
    .from('ledger_entries')
    .delete()
    .eq('category', 'custody_disbursement')
    .eq('direction', 'out')
    .eq('bank_account_id', entry.counterparty_id)
    .eq('counterparty_id', entry.employee_id)
    .eq('amount', entry.amount)
    .eq('created_at', entry.created_at)
    .select();

  console.log('Bank entry delete result:', delBank, 'error:', err2);

  // Try to delete employee entry
  const { data: delEmp, error: err1 } = await adminSupabase
    .from('ledger_entries')
    .delete()
    .eq('id', id)
    .select();

  console.log('Employee entry delete result:', delEmp, 'error:', err1);
}

testDelete();

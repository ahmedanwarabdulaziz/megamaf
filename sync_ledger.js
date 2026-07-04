const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function syncLedger() {
  const { data: accounts, error } = await supabase.from('bank_accounts').select('id, opening_balance, created_at');
  if (error) throw error;
  
  for (const account of accounts) {
    const { data: existing } = await supabase
      .from('ledger_entries')
      .select('id')
      .eq('bank_account_id', account.id)
      .eq('category', 'opening_balance')
      .maybeSingle();
      
    if (account.opening_balance === 0) {
      if (existing) {
        await supabase.from('ledger_entries').delete().eq('id', existing.id);
        console.log(`Deleted 0 opening balance for ${account.id}`);
      }
    } else {
      const direction = account.opening_balance > 0 ? 'in' : 'out';
      const amount = Math.abs(account.opening_balance);
      
      if (existing) {
        await supabase
          .from('ledger_entries')
          .update({ direction, amount })
          .eq('id', existing.id);
        console.log(`Updated opening balance for ${account.id} to ${amount}`);
      } else {
        await supabase
          .from('ledger_entries')
          .insert({
            bank_account_id: account.id,
            category: 'opening_balance',
            direction,
            amount,
            entry_date: account.created_at || new Date().toISOString().split('T')[0],
            counterparty_type: 'bank',
            memo: 'Opening Balance',
          });
        console.log(`Inserted opening balance for ${account.id} to ${amount}`);
      }
    }
  }
  console.log('Sync complete!');
}

syncLedger().catch(console.error);

'use server';

import { createClient } from '@/lib/supabase/server';

export async function getBanks() {
  const supabase = await createClient();
  
  // Fetch banks
  const { data: banks, error: banksError } = await supabase
    .from('banks')
    .select('*')
    .order('name');
    
  if (banksError) throw banksError;

  // Fetch balances view
  const { data: accounts, error: accountsError } = await supabase
    .from('v_bank_account_balances')
    .select('*')
    .order('account_name');

  if (accountsError) throw accountsError;

  // Group accounts by bank
  return banks.map(bank => ({
    ...bank,
    accounts: accounts.filter(acc => acc.bank_id === bank.id),
  }));
}

export async function getBankStatement(accountId: string, limit = 50, offset = 0) {
  const supabase = await createClient();
  
  const { data, error, count } = await supabase
    .from('v_bank_statement')
    .select('*', { count: 'exact' })
    .eq('bank_account_id', accountId)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
    
  if (error) throw error;
  
  // We want to return the statement. Usually statements are viewed chronological,
  // but if we do infinite scroll, descending (newest first) is common for grids.
  // The query above sorts descending.
  
  return {
    items: data,
    totalCount: count || 0,
  };
}

export async function getBankAccountDetails(accountId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_bank_account_balances')
    .select('*')
    .eq('bank_account_id', accountId)
    .single();

  if (error) throw error;
  return data;
}

'use server';

import { createClient } from '@/lib/supabase/server';

export async function getBanks() {
  const supabase = await createClient();
  
  // Run both queries in parallel — was sequential before
  const [{ data: banks, error: banksError }, { data: accounts, error: accountsError }] = await Promise.all([
    supabase
      .from('banks')
      .select('id, name')
      .order('name'),
    supabase
      .from('v_bank_account_balances')
      .select('bank_account_id, bank_id, account_name, account_number, currency, current_balance, current_month_in, current_month_out, initial_balance')
      .order('account_name'),
  ]);

  if (banksError) throw banksError;
  if (accountsError) throw accountsError;

  return (banks ?? []).map(bank => ({
    ...bank,
    accounts: (accounts ?? []).filter(acc => acc.bank_id === bank.id),
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

export async function getAllBanksLedgerSummary({
  startDate,
  endDate,
  showAll,
  bankAccountId,
}: {
  startDate?: string;
  endDate?: string;
  showAll?: boolean;
  bankAccountId?: string;
}) {
  const supabase = await createClient();

  let q = supabase
    .from('ledger_entries')
    .select('direction, amount')
    .not('bank_account_id', 'is', null);

  if (bankAccountId) q = q.eq('bank_account_id', bankAccountId);
  if (!showAll) {
    if (startDate) q = q.gte('entry_date', startDate);
    if (endDate) q = q.lte('entry_date', endDate);
  }

  const { data, error } = await q;
  if (error) throw error;

  let totalIn = 0;
  let totalOut = 0;
  for (const row of data ?? []) {
    if (row.direction === 'in') totalIn += Number(row.amount);
    else totalOut += Number(row.amount);
  }

  return { totalIn, totalOut };
}

export async function getAllBanksLedger({
  startDate,
  endDate,
  showAll,
  bankAccountId,
  limit = 50,
  offset = 0,
}: {
  startDate?: string;
  endDate?: string;
  showAll?: boolean;
  bankAccountId?: string;
  limit?: number;
  offset?: number;
}) {
  const supabase = await createClient();

  let q = supabase
    .from('ledger_entries')
    .select('id, entry_date, direction, amount, category, memo, bank_account_id, bank_accounts(account_name, banks(name))', { count: 'exact' })
    .not('bank_account_id', 'is', null)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (bankAccountId) q = q.eq('bank_account_id', bankAccountId);
  if (!showAll) {
    if (startDate) q = q.gte('entry_date', startDate);
    if (endDate) q = q.lte('entry_date', endDate);
  }

  q = q.range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) throw error;

  return { items: data ?? [], totalCount: count || 0 };
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

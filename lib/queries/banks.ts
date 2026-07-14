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
    .select('id, entry_date, direction, amount, category, memo, bank_account_id, counterparty_type, counterparty_id, created_by, bank_accounts(account_name, banks(name))', { count: 'exact' })
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

  const items = await attachCounterpartyNames(supabase, data ?? []);

  return { items, totalCount: count || 0 };
}

async function attachCounterpartyNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: { counterparty_type: string | null; counterparty_id: string | null; created_by: string | null }[]
) {
  const idsByType: Record<string, Set<string>> = { vendor: new Set(), owner: new Set(), employee: new Set() };
  for (const r of rows) {
    if (r.counterparty_type && r.counterparty_id && idsByType[r.counterparty_type]) {
      idsByType[r.counterparty_type].add(r.counterparty_id);
    }
    if (r.created_by) idsByType.employee.add(r.created_by);
  }

  const [{ data: vendors }, { data: owners }, { data: employees }] = await Promise.all([
    idsByType.vendor.size
      ? supabase.from('vendors').select('id, name').in('id', Array.from(idsByType.vendor))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    idsByType.owner.size
      ? supabase.from('project_owners').select('id, name').in('id', Array.from(idsByType.owner))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    idsByType.employee.size
      ? supabase.from('employees').select('id, full_name').in('id', Array.from(idsByType.employee))
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const nameById: Record<string, string> = {};
  for (const v of vendors ?? []) nameById[v.id] = v.name;
  for (const o of owners ?? []) nameById[o.id] = o.name;
  for (const e of employees ?? []) nameById[e.id] = e.full_name;

  return rows.map((r) => ({
    ...r,
    counterparty_name: r.counterparty_type && r.counterparty_id ? nameById[r.counterparty_id] || null : null,
    created_by_name: r.created_by ? nameById[r.created_by] || null : null,
  }));
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

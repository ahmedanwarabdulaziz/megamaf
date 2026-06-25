import { createClient } from '@/lib/supabase/server';

export async function getExpenseCategories() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
}

export async function getPendingExpenses() {
  const supabase = await createClient();
  const { data: expenses, error } = await supabase
    .from('expenses')
    .select(`
      *,
      project:projects(name),
      employee:employees!expenses_employee_id_fkey(full_name),
      owner:project_owners(name),
      category:expense_categories(name)
    `)
    .eq('status', 'pending')
    .order('expense_date', { ascending: false });
  
  if (error) {
    console.error('[getPendingExpenses]', error);
    return [];
  }
  if (!expenses || expenses.length === 0) return [];

  const { data: attachments } = await supabase
    .from('attachments')
    .select('entity_id, r2_key')
    .eq('entity_type', 'expense')
    .in('entity_id', expenses.map(e => e.id));

  return expenses.map(e => ({
    ...e,
    attachments: attachments?.filter(a => a.entity_id === e.id) || []
  }));
}

export async function getEmployeeExpenses(employeeId: string) {
  const supabase = await createClient();
  const { data: expenses, error } = await supabase
    .from('expenses')
    .select(`
      *,
      project:projects(name),
      category:expense_categories(name)
    `)
    .eq('employee_id', employeeId)
    .order('expense_date', { ascending: false });
    
  if (error) throw error;
  if (!expenses || expenses.length === 0) return [];

  const { data: attachments } = await supabase
    .from('attachments')
    .select('entity_id, r2_key')
    .eq('entity_type', 'expense')
    .in('entity_id', expenses.map(e => e.id));

  return expenses.map(e => ({
    ...e,
    attachments: attachments?.filter(a => a.entity_id === e.id) || []
  }));
}

export async function getOwnerExpenses(ownerId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from('expenses')
    .select(`
      *,
      project:projects(name),
      owner:project_owners(name),
      category:expense_categories(name)
    `)
    .not('owner_id', 'is', null)
    .order('expense_date', { ascending: false });

  if (ownerId) query = query.eq('owner_id', ownerId);

  const { data: expenses, error } = await query;
  if (error) {
    console.error('[getOwnerExpenses]', error);
    return [];
  }
  if (!expenses || expenses.length === 0) return [];

  const { data: attachments } = await supabase
    .from('attachments')
    .select('entity_id, r2_key')
    .eq('entity_type', 'expense')
    .in('entity_id', expenses.map(e => e.id));

  return expenses.map(e => ({
    ...e,
    attachments: attachments?.filter(a => a.entity_id === e.id) || []
  }));
}

export async function getEmployeeCustodyBalance(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_employee_custody_balance')
    .select('*')
    .eq('employee_id', employeeId)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data || { balance: 0, total_disbursed: 0, total_approved_expenses: 0, total_settled: 0 };
}

export async function getAllCustodyBalances() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_employee_custody_balance')
    .select('*')
    .order('full_name');
  if (error) throw error;
  return data;
}

export async function getAllOwnerCustodyBalances() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_owner_custody_balance')
    .select('*')
    .order('name');
  if (error) {
    console.error('[getAllOwnerCustodyBalances]', error);
    return [];
  }
  return data || [];
}

export async function getEmployeeDisbursements(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ledger_entries')
    .select(`
      *,
      bank:banks!ledger_entries_bank_account_id_fkey(name),
      bank_account:bank_accounts(account_name)
    `)
    .eq('employee_id', employeeId)
    .eq('category', 'custody_disbursement')
    .eq('direction', 'in')
    .order('entry_date', { ascending: false });
  if (error) throw error;
  return data;
}

